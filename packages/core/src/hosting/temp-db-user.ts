import { tl } from '@ysk-server/shared';
/**
 * Temporary read-only DB users + remote host registry (control plane).
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { JsonStore } from '../db/store.js';
import type { HostExecutor } from '../host/executor.js';
import { escapeMysqlString, validateMysqlIdent } from './db-client.js';

export type TempDbUser = {
  id: string;
  engine: 'mysql' | 'mariadb' | 'postgres';
  username: string;
  database: string;
  host: string;
  readonly: true;
  expiresAt: string;
  createdAt: string;
  createdBy: string;
  /** last apply status */
  apply_status: 'written' | 'applied' | 'blocked' | 'expired';
  notes: string[];
};

export type RemoteDbHost = {
  id: string;
  engine: 'mysql' | 'mariadb' | 'postgres';
  label: string;
  host: string;
  port: number;
  username?: string;
  /** never returned plaintext after save */
  hasPassword: boolean;
  password?: string;
  createdAt: string;
};

const TEMP_KEY = 'temp_db_users';
const REMOTE_KEY = 'remote_db_hosts';

function loadTemp(db: JsonStore): TempDbUser[] {
  try {
    return JSON.parse(db.snapshot.settings?.[TEMP_KEY] ?? '[]') as TempDbUser[];
  } catch {
    return [];
  }
}
function saveTemp(db: JsonStore, rows: TempDbUser[]): void {
  db.snapshot.settings[TEMP_KEY] = JSON.stringify(rows.slice(0, 100));
  db.persist();
}
function loadRemote(db: JsonStore): RemoteDbHost[] {
  try {
    return JSON.parse(db.snapshot.settings?.[REMOTE_KEY] ?? '[]') as RemoteDbHost[];
  } catch {
    return [];
  }
}
function saveRemote(db: JsonStore, rows: RemoteDbHost[]): void {
  db.snapshot.settings[REMOTE_KEY] = JSON.stringify(rows.slice(0, 50));
  db.persist();
}

export function listTempDbUsers(db: JsonStore): TempDbUser[] {
  const now = new Date().toISOString();
  return loadTemp(db).map((u) =>
    u.expiresAt < now && u.apply_status !== 'expired'
      ? { ...u, apply_status: 'expired' as const }
      : u,
  );
}

export async function createTempReadonlyUser(input: {
  db: JsonStore;
  host: HostExecutor;
  engine: 'mysql' | 'mariadb' | 'postgres';
  database: string;
  username?: string;
  ttlHours?: number;
  actor: string;
  apply?: boolean;
}): Promise<{ ok: boolean; user?: TempDbUser; password?: string; notes: string[] }> {
  const ttl = Math.min(Math.max(input.ttlHours ?? 24, 1), 168);
  const username =
    input.username?.trim() ||
    `ro_${randomBytes(3).toString('hex')}`;
  // Fail closed: reject injected identifiers
  validateMysqlIdent(username, 'username');
  validateMysqlIdent(input.database, 'database');
  const password = randomBytes(12).toString('base64url');
  const expiresAt = new Date(Date.now() + ttl * 3600_000).toISOString();
  const notes: string[] = [];
  const row: TempDbUser = {
    id: randomUUID(),
    engine: input.engine,
    username,
    database: input.database,
    host: 'localhost',
    readonly: true,
    expiresAt,
    createdAt: new Date().toISOString(),
    createdBy: input.actor,
    apply_status: 'written',
    notes: [] };

  if (input.apply) {
    if (!input.host.executeEnabled() || !input.host.isRoot()) {
      row.apply_status = 'blocked';
      notes.push(tl('notes.auto.n1157'));
    } else if (input.engine === 'postgres') {
      // Identifiers already validated; password dollar-quoted to avoid injection
      const sql = `DO $$ BEGIN CREATE ROLE ${username} LOGIN PASSWORD $ysk$${password}$ysk$; EXCEPTION WHEN duplicate_object THEN NULL; END $$; GRANT CONNECT ON DATABASE ${input.database} TO ${username}; GRANT USAGE ON SCHEMA public TO ${username}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${username};`;
      const r = await input.host.runCommand(
        ['bash', '-c', `sudo -u postgres psql -d ${JSON.stringify(input.database)} -c ${JSON.stringify(sql)} 2>&1`],
        { timeoutMs: 30_000 },
      );
      if (r.exitCode === 0) {
        row.apply_status = 'applied';
        notes.push(tl('notes.auto.n0783'));
      } else {
        row.apply_status = 'blocked';
        notes.push(tl('notes.auto.t0261', { v0: ((r.stderr || r.stdout).slice(0, 200)) }));
      }
    } else {
      const escPass = escapeMysqlString(password);
      const sql = [
        `CREATE USER '${username}'@'localhost' IDENTIFIED BY '${escPass}';`,
        `GRANT SELECT ON \`${input.database}\`.* TO '${username}'@'localhost';`,
        'FLUSH PRIVILEGES;',
      ].join(' ');
      const r = await input.host.runCommand(
        [
          'bash',
          '-c',
          `mysql -e ${JSON.stringify(sql)} 2>&1 || mariadb -e ${JSON.stringify(sql)} 2>&1`,
        ],
        { timeoutMs: 30_000 },
      );
      if (r.exitCode === 0) {
        row.apply_status = 'applied';
        notes.push(tl('notes.auto.n0782'));
      } else {
        row.apply_status = 'blocked';
        notes.push(tl('notes.auto.t0262', { v0: ((r.stderr || r.stdout).slice(0, 200)) }));
      }
    }
  } else {
    notes.push(tl('notes.auto.n0570'));
  }

  row.notes = notes;
  const all = loadTemp(input.db);
  all.unshift(row);
  saveTemp(input.db, all);
  return {
    ok: row.apply_status !== 'blocked' || !input.apply,
    user: row,
    password,
    notes };
}

export function revokeTempDbUser(db: JsonStore, id: string): { ok: boolean; notes: string[] } {
  const all = loadTemp(db);
  const next = all.filter((u) => u.id !== id);
  if (next.length === all.length) return { ok: false, notes: [tl('notes.notFound')] };
  saveTemp(db, next);
  return {
    ok: true,
    notes: [tl('notes.auto.n0776')] };
}

/**
 * Drop expired temp RO users from MySQL/Postgres when EXECUTE+root; always mark expired in store.
 */
export async function expireTempDbUsers(input: {
  db: JsonStore;
  host: HostExecutor;
  /** When true, attempt system DROP USER / DROP ROLE */
  dropSystem?: boolean;
}): Promise<{
  ok: boolean;
  expired: number;
  dropped: number;
  notes: string[];
  blocked?: boolean;
}> {
  const now = new Date().toISOString();
  const all = loadTemp(input.db);
  const notes: string[] = [];
  let expired = 0;
  let dropped = 0;
  let blocked = false;
  const next: TempDbUser[] = [];

  for (const u of all) {
    if (u.expiresAt >= now && u.apply_status !== 'expired') {
      next.push(u);
      continue;
    }
    expired++;
    const row: TempDbUser = { ...u, apply_status: 'expired' };
    if (input.dropSystem && u.apply_status === 'applied') {
      if (!input.host.executeEnabled() || !input.host.isRoot()) {
        blocked = true;
        notes.push(tl('notes.auto.t0263', { v0: (u.username) }));
        next.push(row);
        continue;
      }
      if (u.engine === 'postgres') {
        const sql = `REASSIGN OWNED BY ${u.username} TO postgres; DROP OWNED BY ${u.username}; DROP ROLE IF EXISTS ${u.username};`;
        const r = await input.host.runCommand(
          [
            'bash',
            '-c',
            `sudo -u postgres psql -d postgres -c ${JSON.stringify(sql)} 2>&1`,
          ],
          { timeoutMs: 15_000 },
        );
        if (r.exitCode === 0) {
          dropped++;
          notes.push(`${u.username}: PostgreSQL role dropped`);
          // remove from store after drop
          continue;
        }
        notes.push(tl('notes.auto.t0264', { v0: (u.username), v1: ((r.stderr || r.stdout).slice(0, 120)) }));
        next.push(row);
      } else {
        const sql = `DROP USER IF EXISTS '${u.username}'@'localhost'; FLUSH PRIVILEGES;`;
        const r = await input.host.runCommand(
          [
            'bash',
            '-c',
            `mysql -e ${JSON.stringify(sql)} 2>&1 || mariadb -e ${JSON.stringify(sql)} 2>&1`,
          ],
          { timeoutMs: 15_000 },
        );
        if (r.exitCode === 0) {
          dropped++;
          notes.push(`${u.username}: MySQL user dropped`);
          continue;
        }
        notes.push(tl('notes.auto.t0265', { v0: (u.username), v1: ((r.stderr || r.stdout).slice(0, 120)) }));
        next.push(row);
      }
    } else {
      next.push(row);
      notes.push(tl('notes.auto.t0266', { v0: (u.username) }));
    }
  }

  saveTemp(input.db, next);
  return {
    ok: !blocked || dropped > 0 || expired === 0,
    expired,
    dropped,
    notes: notes.length ? notes : [tl('notes.auto.n1199')],
    blocked: blocked || undefined };
}

export function listRemoteDbHosts(db: JsonStore): Array<Omit<RemoteDbHost, 'password'>> {
  return loadRemote(db).map(({ password: _p, ...rest }) => ({
    ...rest,
    hasPassword: Boolean(_p) || rest.hasPassword }));
}

export function upsertRemoteDbHost(
  db: JsonStore,
  input: {
    id?: string;
    engine: 'mysql' | 'mariadb' | 'postgres';
    label: string;
    host: string;
    port?: number;
    username?: string;
    password?: string;
  },
): Omit<RemoteDbHost, 'password'> {
  const all = loadRemote(db);
  const id = input.id ?? randomUUID();
  const existing = all.find((h) => h.id === id);
  const row: RemoteDbHost = {
    id,
    engine: input.engine,
    label: input.label.trim() || input.host,
    host: input.host.trim(),
    port: input.port ?? (input.engine === 'postgres' ? 5432 : 3306),
    username: input.username,
    hasPassword: Boolean(input.password) || Boolean(existing?.password),
    password: input.password || existing?.password,
    createdAt: existing?.createdAt ?? new Date().toISOString() };
  const next = [row, ...all.filter((h) => h.id !== id)];
  saveRemote(db, next);
  const { password: _p, ...pub } = row;
  return { ...pub, hasPassword: Boolean(_p) };
}

export function deleteRemoteDbHost(db: JsonStore, id: string): boolean {
  const all = loadRemote(db);
  const next = all.filter((h) => h.id !== id);
  saveRemote(db, next);
  return next.length < all.length;
}
