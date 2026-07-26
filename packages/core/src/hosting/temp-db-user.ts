/**
 * Temporary read-only DB users + remote host registry (control plane).
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { JsonStore } from '../db/store.js';
import type { HostExecutor } from '../host/executor.js';

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
    notes: [],
  };

  if (input.apply) {
    if (!input.host.executeEnabled() || !input.host.isRoot()) {
      row.apply_status = 'blocked';
      notes.push('無法在系統建立帳號：需要 YSK_EXECUTE + root；已登記控制面（written/blocked）');
    } else if (input.engine === 'postgres') {
      const sql = `DO $$ BEGIN CREATE ROLE ${username} LOGIN PASSWORD '${password}'; EXCEPTION WHEN duplicate_object THEN NULL; END $$; GRANT CONNECT ON DATABASE ${input.database} TO ${username}; GRANT USAGE ON SCHEMA public TO ${username}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${username};`;
      const r = await input.host.runCommand(
        ['bash', '-c', `sudo -u postgres psql -d ${JSON.stringify(input.database)} -c ${JSON.stringify(sql)} 2>&1`],
        { timeoutMs: 30_000 },
      );
      if (r.exitCode === 0) {
        row.apply_status = 'applied';
        notes.push('已於 PostgreSQL 建立只讀角色');
      } else {
        row.apply_status = 'blocked';
        notes.push(`PostgreSQL 失敗: ${(r.stderr || r.stdout).slice(0, 200)}`);
      }
    } else {
      const sql = [
        `CREATE USER '${username}'@'localhost' IDENTIFIED BY '${password}';`,
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
        notes.push('已於 MySQL/MariaDB 建立只讀用戶');
      } else {
        row.apply_status = 'blocked';
        notes.push(`MySQL 失敗: ${(r.stderr || r.stdout).slice(0, 200)}`);
      }
    }
  } else {
    notes.push('僅控制面登記（apply:false）；密碼只回傳一次');
  }

  row.notes = notes;
  const all = loadTemp(input.db);
  all.unshift(row);
  saveTemp(input.db, all);
  return {
    ok: row.apply_status !== 'blocked' || !input.apply,
    user: row,
    password,
    notes,
  };
}

export function revokeTempDbUser(db: JsonStore, id: string): { ok: boolean; notes: string[] } {
  const all = loadTemp(db);
  const next = all.filter((u) => u.id !== id);
  if (next.length === all.length) return { ok: false, notes: ['找不到'] };
  saveTemp(db, next);
  return {
    ok: true,
    notes: ['已從控制面移除；系統帳號需手動 DROP USER（誠實：未自動 drop）'],
  };
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
        notes.push(`${u.username}: 無法 DROP — 需 EXECUTE+root（已標記 expired）`);
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
        notes.push(`${u.username}: DROP 失敗 ${(r.stderr || r.stdout).slice(0, 120)}`);
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
        notes.push(`${u.username}: DROP 失敗 ${(r.stderr || r.stdout).slice(0, 120)}`);
        next.push(row);
      }
    } else {
      next.push(row);
      notes.push(`${u.username}: 已標記 expired（未 DROP 系統帳號）`);
    }
  }

  saveTemp(input.db, next);
  return {
    ok: !blocked || dropped > 0 || expired === 0,
    expired,
    dropped,
    notes: notes.length ? notes : ['無過期臨時用戶'],
    blocked: blocked || undefined,
  };
}

export function listRemoteDbHosts(db: JsonStore): Array<Omit<RemoteDbHost, 'password'>> {
  return loadRemote(db).map(({ password: _p, ...rest }) => ({
    ...rest,
    hasPassword: Boolean(_p) || rest.hasPassword,
  }));
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
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
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
