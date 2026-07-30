import { tl } from '@ysk/shared';
/**
 * SQL dump export/import for MySQL/MariaDB/Postgres — honest fail-closed.
 */

import { mkdirSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';

export type SqlDumpEngine = 'mysql' | 'mariadb' | 'postgres';

export interface DumpResult {
  ok: boolean;
  path?: string;
  notes: string[];
  requiresExecute: boolean;
  blocked?: boolean;
}

export async function dumpSqlDatabase(input: {
  host: HostExecutor;
  dataDir: string;
  engine: SqlDumpEngine;
  dbName: string;
  username?: string;
  password?: string;
  /**
   * Absolute path for the dump file. When set, skips default
   * dataDir/db-dumps/{engine}/{db}-{stamp}.sql layout.
   */
  outputPath?: string;
}): Promise<DumpResult> {
  const db = input.dbName.replace(/[^a-zA-Z0-9_]/g, '');
  if (!db) return { ok: false, notes: [tl('notes.auto.n1119')], requiresExecute: false };
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      notes: [tl('notes.auto.n1125')] };
  }
  let out: string;
  if (input.outputPath) {
    out = input.outputPath;
    mkdirSync(dirname(out), { recursive: true });
  } else {
    const dir = join(input.dataDir, 'db-dumps', input.engine);
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    out = join(dir, `${db}-${stamp}.sql`);
  }

  if (input.engine === 'postgres') {
    const user = input.username || 'postgres';
    const pw = (input.password || '').replace(/'/g, `'\\''`);
    const r = await input.host.runCommand(
      [
        'bash',
        '-c',
        `PGPASSWORD='${pw}' pg_dump -U ${user} -d ${db} -f ${JSON.stringify(out)} 2>&1`,
      ],
      { timeoutMs: 180_000 },
    );
    return {
      ok: r.exitCode === 0 && existsSync(out),
      path: r.exitCode === 0 ? out : undefined,
      requiresExecute: false,
      notes: [
        r.exitCode === 0 ? tl('notes.tpl.exported', { path: out }) : tl('notes.auto.t0341', { v0: (r.stderr || r.stdout) }),
      ] };
  }

  const client = input.engine === 'mariadb' ? 'mariadb-dump' : 'mysqldump';
  const fallback = 'mysqldump';
  const user = input.username || 'root';
  const passFlag = input.password ? `-p'${input.password.replace(/'/g, `'\\''`)}'` : '';
  const r = await input.host.runCommand(
    [
      'bash',
      '-c',
      `(command -v ${client} >/dev/null && ${client} || ${fallback}) -u ${user} ${passFlag} ${db} > ${JSON.stringify(out)} 2>&1`,
    ],
    { timeoutMs: 180_000 },
  );
  // mysqldump writes to stdout redirected; check file size
  const ok = existsSync(out) && statSafe(out) > 0;
  return {
    ok,
    path: ok ? out : undefined,
    requiresExecute: false,
    notes: [ok ? tl('notes.tpl.exported', { path: out }) : tl('notes.auto.t0342', { v0: (r.stderr || r.stdout || 'empty file') })] };
}

export async function importSqlDatabase(input: {
  host: HostExecutor;
  engine: SqlDumpEngine;
  dbName: string;
  sqlPath: string;
  username?: string;
  password?: string;
}): Promise<DumpResult> {
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      notes: [tl('notes.auto.n1127')] };
  }
  if (!existsSync(input.sqlPath)) {
    return { ok: false, notes: [tl('notes.auto.n0848')], requiresExecute: false };
  }
  const db = input.dbName.replace(/[^a-zA-Z0-9_]/g, '');
  if (input.engine === 'postgres') {
    const user = input.username || 'postgres';
    const pw = (input.password || '').replace(/'/g, `'\\''`);
    const r = await input.host.runCommand(
      [
        'bash',
        '-c',
        `PGPASSWORD='${pw}' psql -U ${user} -d ${db} -f ${JSON.stringify(input.sqlPath)} 2>&1`,
      ],
      { timeoutMs: 180_000 },
    );
    return {
      ok: r.exitCode === 0,
      requiresExecute: false,
      notes: [r.exitCode === 0 ? tl('notes.auto.n0020') : tl('notes.auto.t0343', { v0: (r.stderr || r.stdout) })] };
  }
  const client = input.engine === 'mariadb' ? 'mariadb' : 'mysql';
  const user = input.username || 'root';
  const passFlag = input.password ? `-p'${input.password.replace(/'/g, `'\\''`)}'` : '';
  const r = await input.host.runCommand(
    [
      'bash',
      '-c',
      `${client} -u ${user} ${passFlag} ${db} < ${JSON.stringify(input.sqlPath)} 2>&1`,
    ],
    { timeoutMs: 180_000 },
  );
  return {
    ok: r.exitCode === 0,
    requiresExecute: false,
    notes: [r.exitCode === 0 ? tl('notes.auto.n0020') : tl('notes.auto.t0344', { v0: (r.stderr || r.stdout) })] };
}

function statSafe(p: string): number {
  try {
    return readFileSync(p).length;
  } catch {
    return 0;
  }
}

/** List managed dump files under dataDir/db-dumps */
export function listSqlDumps(
  dataDir: string,
  engine?: SqlDumpEngine,
): Array<{ engine: string; name: string; path: string; bytes: number; mtime: string }> {
  const root = join(dataDir, 'db-dumps');
  if (!existsSync(root)) return [];
  const engines = engine ? [engine] : ['mysql', 'mariadb', 'postgres'];
  const out: Array<{ engine: string; name: string; path: string; bytes: number; mtime: string }> =
    [];
  for (const eng of engines) {
    const dir = join(root, eng);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.sql')) continue;
      const path = join(dir, name);
      try {
        const st = statSync(path);
        out.push({
          engine: eng,
          name,
          path,
          bytes: st.size,
          mtime: st.mtime.toISOString() });
      } catch {
        /* skip */
      }
    }
  }
  return out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}
