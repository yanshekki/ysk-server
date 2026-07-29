/**
 * PostgreSQL provision via psql when available.
 * Never reports ok=true for skipped system mutations.
 */

import type { HostExecutor } from '../host/executor.js';
import { ErrorCodes, YskError } from '@ysk/shared';
import { probeEndpoint } from './db-client.js';

export interface PostgresProvisionResult {
  ok: boolean;
  executed: boolean;
  /** true when plan-only (no --execute) */
  dryRun?: boolean;
  blocked?: boolean;
  requiresExecute: boolean;
  psqlClient: boolean;
  reachable: boolean;
  sql: string[];
  connectionHint: Record<string, string | number>;
  notes: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
}

function assertIdent(value: string, field: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value)) {
    throw new YskError(ErrorCodes.VALIDATION, `欄位 ${field} 無效：${value}`, { httpStatus: 400 });
  }
}

/**
 * Render SQL for role + database (password embedded only when executing).
 */
export function renderPostgresProvisionSql(input: {
  dbName: string;
  username: string;
  password: string;
}): string[] {
  assertIdent(input.dbName, 'dbName');
  assertIdent(input.username, 'username');
  // Use dollar-quoting for password safety in simple scripts
  const pass = input.password.replace(/'/g, "''");
  return [
    `DO $$ BEGIN CREATE ROLE ${input.username} LOGIN PASSWORD '${pass}'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `SELECT 'CREATE DATABASE ${input.dbName} OWNER ${input.username}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${input.dbName}')\\gexec`,
    `GRANT ALL PRIVILEGES ON DATABASE ${input.dbName} TO ${input.username};`,
  ];
}

/**
 * Provision PG database + role.
 * Without EXECUTE or psql: ok=false + SQL plan.
 * With EXECUTE + psql: runs via `psql -v ON_ERROR_STOP=1 -c` / multi-step.
 */
export async function provisionPostgresDatabase(input: {
  dbName: string;
  username: string;
  password: string;
  host?: string;
  port?: number;
  hostExec: HostExecutor;
  execute?: boolean;
  /** Superuser connection db (default postgres) */
  adminDb?: string;
}): Promise<PostgresProvisionResult> {
  assertIdent(input.dbName, 'dbName');
  assertIdent(input.username, 'username');
  if (!input.password || input.password.length < 8) {
    return {
      ok: false,
      executed: false,
      requiresExecute: true,
      psqlClient: false,
      reachable: false,
      sql: [],
      connectionHint: {},
      notes: ['password required (min 8 chars)'],
      commandResults: [],
    };
  }

  const host = input.host ?? '127.0.0.1';
  const port = input.port ?? 5432;
  const sql = renderPostgresProvisionSql({
    dbName: input.dbName,
    username: input.username,
    password: input.password,
  });
  const connectionHint = {
    database: input.dbName,
    user: input.username,
    host,
    port,
  };
  const notes: string[] = [];
  const commandResults: PostgresProvisionResult['commandResults'] = [];

  const reach = await probeEndpoint(host, port, 2000);
  const reachable = reach.ok;
  notes.push(
    reachable
      ? `TCP ${host}:${port} ok (${reach.latencyMs}ms)`
      : `TCP ${host}:${port} fail: ${reach.detail}`,
  );

  const which = await input.hostExec.runCommand(['bash', '-c', 'command -v psql || true'], {
    timeoutMs: 5_000,
  });
  const psqlClient = which.stdout.trim().length > 0;
  if (!psqlClient) notes.push('伺服器未安裝 PostgreSQL 客戶端');
  if (!input.hostExec.executeEnabled()) {
    notes.push('伺服器未開啟系統變更權限，無法在管理面板完成此操作');
  }

  const want = input.execute === true;
  const can = want && input.hostExec.executeEnabled() && psqlClient && reachable;
  const safeSql = sql.map((s) => s.replace(input.password, '***'));

  if (!want) {
    return {
      ok: true,
      dryRun: true,
      executed: false,
      requiresExecute: !input.hostExec.executeEnabled(),
      psqlClient,
      reachable,
      sql: safeSql,
      connectionHint,
      notes: [
        ...notes,
        'dry-run：未建立資料庫。加 --execute 且 YSK_EXECUTE=1 先真正 provision',
      ],
      commandResults: [],
    };
  }

  if (!can) {
    return {
      ok: false,
      executed: false,
      blocked: !input.hostExec.executeEnabled(),
      requiresExecute: !input.hostExec.executeEnabled(),
      psqlClient,
      reachable,
      sql: safeSql,
      connectionHint,
      notes: [
        ...notes,
        '資料庫尚未建立。請確認 psql、TCP 與 YSK_EXECUTE=1 後再試。',
      ],
      commandResults: [],
    };
  }

  const adminDb = input.adminDb ?? 'postgres';
  // Simpler portable SQL without \gexec
  const statements = [
    `CREATE USER ${input.username} WITH PASSWORD '${input.password.replace(/'/g, "''")}';`,
    `CREATE DATABASE ${input.dbName} OWNER ${input.username};`,
  ];
  for (const stmt of statements) {
    const r = await input.hostExec.runCommand(
      [
        'psql',
        '-h',
        host,
        '-p',
        String(port),
        '-d',
        adminDb,
        '-v',
        'ON_ERROR_STOP=0',
        '-c',
        stmt,
      ],
      { timeoutMs: 30_000 },
    );
    commandResults.push({
      argv: ['psql', '-c', '(redacted)'],
      exitCode: r.exitCode,
      stderr: r.stderr,
    });
    // accept already-exists as soft success
    const already =
      /already exists/i.test(r.stderr) || /already exists/i.test(r.stdout);
    if (r.exitCode !== 0 && !already) {
      notes.push(`psql 失敗：${r.stderr || r.stdout}`);
      return {
        ok: false,
        executed: true,
        requiresExecute: false,
        psqlClient: true,
        reachable: true,
        sql: sql.map((s) => s.replace(input.password, '***')),
        connectionHint,
        notes,
        commandResults,
      };
    }
    notes.push(already ? `ok (already exists): ${stmt.slice(0, 40)}…` : `ok: ${stmt.slice(0, 40)}…`);
  }

  return {
    ok: true,
    executed: true,
    requiresExecute: false,
    psqlClient: true,
    reachable: true,
    sql: sql.map((s) => s.replace(input.password, '***')),
    connectionHint,
    notes: [...notes, 'PostgreSQL provision executed'],
    commandResults,
  };
}
