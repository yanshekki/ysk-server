/**
 * Real MySQL/MariaDB provision via mysql CLI when available.
 * Never reports ok=true for skipped system mutations.
 */

import type { HostExecutor } from '../host/executor.js';
import { renderMysqlProvisionSql, validateMysqlIdent } from './db-client.js';

export interface MysqlProvisionResult {
  ok: boolean;
  executed: boolean;
  requiresExecute: boolean;
  requiresRoot: boolean;
  mysqlClient: boolean;
  sql: string[];
  connectionHint: Record<string, string>;
  notes: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
}

/**
 * Provision database + user.
 * - Without YSK_EXECUTE or without mysql client: ok=false, executed=false, returns SQL to copy.
 * - With EXECUTE + mysql client: runs SQL via `mysql -e`.
 */
export async function provisionMysqlDatabase(input: {
  dbName: string;
  username: string;
  password: string;
  host?: string;
  hostExec: HostExecutor;
  execute?: boolean;
}): Promise<MysqlProvisionResult> {
  validateMysqlIdent(input.dbName, 'dbName');
  validateMysqlIdent(input.username, 'username');
  if (!input.password || input.password.length < 8) {
    return {
      ok: false,
      executed: false,
      requiresExecute: true,
      requiresRoot: false,
      mysqlClient: false,
      sql: [],
      connectionHint: {},
      notes: ['password required (min 8 chars)'],
      commandResults: [],
    };
  }

  const { sql, connectionHint } = renderMysqlProvisionSql({
    dbName: input.dbName,
    username: input.username,
    password: input.password,
    host: input.host ?? 'localhost',
  });

  const which = await input.hostExec.runCommand(['bash', '-c', 'command -v mysql || true'], {
    timeoutMs: 5_000,
  });
  const mysqlClient = which.stdout.trim().length > 0;
  const wantsExecute = input.execute !== false;
  const canExecute = wantsExecute && input.hostExec.executeEnabled() && mysqlClient;

  const notes: string[] = [];
  if (!mysqlClient) notes.push('mysql client not found on PATH');
  if (!input.hostExec.executeEnabled()) notes.push('YSK_EXECUTE not enabled — refusing to mutate MySQL');
  if (!wantsExecute) notes.push('execute=false — returning plan only');

  if (!canExecute) {
    return {
      ok: false,
      executed: false,
      requiresExecute: !input.hostExec.executeEnabled(),
      requiresRoot: false,
      mysqlClient,
      sql,
      connectionHint,
      notes: [
        ...notes,
        'NOT provisioned. Copy SQL below and run as DB admin, or set YSK_EXECUTE=1 with mysql client.',
      ],
      commandResults: [],
    };
  }

  // Run as single multi-statement via mysql
  const script = sql.join('\n');
  const r = await input.hostExec.runCommand(
    ['mysql', '-e', script],
    { timeoutMs: 30_000 },
  );
  const ok = r.exitCode === 0;
  return {
    ok,
    executed: true,
    requiresExecute: false,
    requiresRoot: false,
    mysqlClient: true,
    sql: sql.map((s) => s.replace(input.password, '***')),
    connectionHint,
    notes: ok
      ? ['MySQL provision executed successfully']
      : [`mysql failed: ${r.stderr || r.stdout}`],
    commandResults: [{ argv: ['mysql', '-e', '(redacted)'], exitCode: r.exitCode, stderr: r.stderr }],
  };
}
