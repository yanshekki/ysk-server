/**
 * Document-store backends for control-plane state (D4).
 *
 * All backends subclass JsonStore so product code keeps db.snapshot + persist.
 *
 * - json     → atomic ysk.json (default)
 * - sqlite   → sql.js via child process (pure JS, no native segfault risk)
 * - postgres → optional `pg` via child process (experimental)
 *
 * Full relational schema remains in schema.ts for a future phase.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { ErrorCodes, YskError } from '@yanshekki/shared';
import { JsonStore, type StoreData, type YskDatabase } from './store.js';

export type StoreBackendKind = 'json' | 'sqlite' | 'postgres';

export type OpenStoreOptions = {
  kind?: StoreBackendKind;
  path?: string;
  url?: string;
};

const require = createRequire(import.meta.url);

export function resolveStoreBackend(opts: OpenStoreOptions = {}): {
  kind: StoreBackendKind;
  path?: string;
  url?: string;
} {
  const envKind = (process.env.YSK_STORE ?? process.env.YSK_DB_BACKEND ?? '')
    .trim()
    .toLowerCase();
  const envUrl = (process.env.YSK_DATABASE_URL ?? process.env.DATABASE_URL ?? '').trim();
  const path = opts.path?.trim();
  const url = (opts.url ?? envUrl).trim() || undefined;

  if (opts.kind) return { kind: opts.kind, path, url };
  if (envKind === 'sqlite' || envKind === 'json' || envKind === 'postgres') {
    return { kind: envKind, path, url };
  }
  if (url?.startsWith('postgres://') || url?.startsWith('postgresql://')) {
    return { kind: 'postgres', path, url };
  }
  if (path?.endsWith('.sqlite') || path?.endsWith('.db')) {
    return { kind: 'sqlite', path, url };
  }
  return { kind: 'json', path, url };
}

function ensureParent(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function runNodeScript(script: string, timeoutMs = 60_000): string {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  try {
    return execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const detail =
      (typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString?.()) ||
      err.message ||
      String(e);
    throw new YskError(ErrorCodes.CONFIG_INVALID, detail.slice(0, 400), {
      httpStatus: 500,
    });
  }
}

/** JsonStore dual-write to SQLite file via sql.js (child process). */
export class ShellSqliteJsonStore extends JsonStore {
  readonly backendKind: StoreBackendKind = 'sqlite';
  /**
   * Set after super() — JsonStore ctor may call persist() before subclass fields init.
   * Guard dual-write until ready, then persist again from openSqliteDocumentStore.
   */
  private _sqlitePath: string | undefined;

  get sqlitePath(): string {
    return this._sqlitePath ?? '';
  }

  constructor(sqlitePath: string, mirrorJsonPath: string) {
    super(mirrorJsonPath);
    this._sqlitePath = sqlitePath;
  }

  override persist(): void {
    super.persist();
    const sqlitePath = this._sqlitePath;
    // super() may invoke persist before _sqlitePath is assigned
    if (!sqlitePath) return;

    const body = JSON.stringify(this.snapshot, null, 2);
    const at = new Date().toISOString();
    let sqlAsmPath: string;
    try {
      sqlAsmPath = require.resolve('sql.js/dist/sql-asm.js');
    } catch {
      throw new YskError(
        ErrorCodes.CONFIG_INVALID,
        'sql.js not installed — cannot use SQLite store (YSK_STORE=json is default)',
        { httpStatus: 500 },
      );
    }
    // Spool body to avoid huge -e argv / escape issues
    const spoolPath = `${sqlitePath}.spool.${process.pid}.json`;
    writeFileSync(spoolPath, body, 'utf8');
    const script = `
      const fs = require('fs');
      const path = require('path');
      const sqlitePath = ${JSON.stringify(sqlitePath)};
      const spoolPath = ${JSON.stringify(spoolPath)};
      const at = ${JSON.stringify(at)};
      const body = fs.readFileSync(spoolPath, 'utf8');
      (async () => {
        try {
          const initSqlJs = require(${JSON.stringify(sqlAsmPath)});
          const SQL = await initSqlJs();
          let db;
          if (fs.existsSync(sqlitePath)) db = new SQL.Database(fs.readFileSync(sqlitePath));
          else db = new SQL.Database();
          db.run(\`CREATE TABLE IF NOT EXISTS ysk_document (
            id TEXT PRIMARY KEY CHECK (id = 'main'),
            body TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )\`);
          db.run('DELETE FROM ysk_document WHERE id = ?', ['main']);
          db.run('INSERT INTO ysk_document (id, body, updated_at) VALUES (?,?,?)', ['main', body, at]);
          const data = db.export();
          const dir = path.dirname(sqlitePath);
          if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
          const tmp = sqlitePath + '.tmp';
          fs.writeFileSync(tmp, Buffer.from(data));
          fs.renameSync(tmp, sqlitePath);
          db.close();
          try { fs.unlinkSync(spoolPath); } catch {}
        } catch (e) {
          console.error(e);
          process.exit(1);
        }
      })();
    `;
    try {
      runNodeScript(script);
    } finally {
      try {
        if (existsSync(spoolPath)) unlinkSync(spoolPath);
      } catch {
        /* ignore */
      }
    }
  }
}

/** JsonStore dual-write to Postgres (experimental). */
export class PostgresJsonStore extends JsonStore {
  readonly backendKind: StoreBackendKind = 'postgres';
  private _connectionUrl: string | undefined;

  get connectionUrl(): string {
    return this._connectionUrl ?? '';
  }

  constructor(url: string, mirrorJsonPath: string) {
    super(mirrorJsonPath);
    this._connectionUrl = url;
  }

  override persist(): void {
    super.persist();
    if (!this._connectionUrl) return;
    const body = JSON.stringify(this.snapshot, null, 2);
    const at = new Date().toISOString();
    const spoolPath = `/tmp/ysk-pg-spool-${process.pid}.json`;
    writeFileSync(spoolPath, body, 'utf8');
    const script = `
      const { readFileSync } = require('fs');
      let Client;
      try { Client = require('pg').Client; } catch (e) {
        console.error('pg package missing');
        process.exit(2);
      }
      const body = readFileSync(${JSON.stringify(spoolPath)}, 'utf8');
      const c = new Client({ connectionString: ${JSON.stringify(this._connectionUrl)} });
      (async () => {
        await c.connect();
        await c.query(\`CREATE TABLE IF NOT EXISTS ysk_document (
          id TEXT PRIMARY KEY CHECK (id = 'main'),
          body TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )\`);
        await c.query(
          \`INSERT INTO ysk_document (id, body, updated_at) VALUES ('main', $1, $2)
           ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at\`,
          [body, ${JSON.stringify(at)}]
        );
        await c.end();
      })().catch((e) => { console.error(e); process.exit(1); });
    `;
    try {
      runNodeScript(script, 30_000);
    } catch (e) {
      throw new YskError(
        ErrorCodes.CONFIG_INVALID,
        'Postgres persist failed (is `pg` installed and YSK_DATABASE_URL reachable?)',
        {
          httpStatus: 500,
          details: { cause: e instanceof Error ? e.message : String(e) },
        },
      );
    }
  }
}

export function openSqliteDocumentStore(sqlitePath: string): ShellSqliteJsonStore {
  ensureParent(sqlitePath);
  const mirrorPath = `${sqlitePath}.mirror.json`;

  if (existsSync(sqlitePath)) {
    try {
      let sqlAsmPath: string;
      try {
        sqlAsmPath = require.resolve('sql.js/dist/sql-asm.js');
      } catch {
        throw new YskError(
          ErrorCodes.CONFIG_INVALID,
          'sql.js not installed — cannot use SQLite store',
          { httpStatus: 500 },
        );
      }
      const script = `
        const fs = require('fs');
        const sqlitePath = ${JSON.stringify(sqlitePath)};
        (async () => {
          const initSqlJs = require(${JSON.stringify(sqlAsmPath)});
          const SQL = await initSqlJs();
          const db = new SQL.Database(fs.readFileSync(sqlitePath));
          let body = '';
          try {
            const r = db.exec("SELECT body FROM ysk_document WHERE id = 'main'");
            if (r[0] && r[0].values[0]) body = r[0].values[0][0] || '';
          } catch {}
          db.close();
          process.stdout.write(typeof body === 'string' ? body : '');
        })().catch((e) => { console.error(e); process.exit(1); });
      `;
      const body = runNodeScript(script);
      if (body?.trim()) writeFileSync(mirrorPath, body, 'utf8');
    } catch {
      /* empty */
    }
  }

  if (!existsSync(mirrorPath)) {
    const siblingJson = sqlitePath.replace(/\.sqlite$/, '.json').replace(/\.db$/, '.json');
    if (existsSync(siblingJson)) {
      writeFileSync(mirrorPath, readFileSync(siblingJson, 'utf8'), 'utf8');
    }
  }

  const store = new ShellSqliteJsonStore(sqlitePath, mirrorPath);
  // dual-write now that _sqlitePath is set (ctor super() may have skipped sqlite)
  store.persist();
  return store;
}

export function openPostgresDocumentStore(url: string): PostgresJsonStore {
  if (!url?.trim()) {
    throw new YskError(ErrorCodes.CONFIG_INVALID, 'Postgres backend needs YSK_DATABASE_URL', {
      httpStatus: 500,
    });
  }
  try {
    require.resolve('pg');
  } catch {
    throw new YskError(
      ErrorCodes.CONFIG_INVALID,
      'Postgres backend requires optional package `pg`. Install pg or use YSK_STORE=json|sqlite.',
      { httpStatus: 500 },
    );
  }
  const mirrorPath = `/tmp/ysk-pg-mirror-${Buffer.from(url).toString('hex').slice(0, 16)}.json`;
  try {
    const script = `
      const { Client } = require('pg');
      const c = new Client({ connectionString: ${JSON.stringify(url)} });
      (async () => {
        await c.connect();
        await c.query(\`CREATE TABLE IF NOT EXISTS ysk_document (
          id TEXT PRIMARY KEY CHECK (id = 'main'),
          body TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )\`);
        const r = await c.query("SELECT body FROM ysk_document WHERE id = 'main'");
        process.stdout.write(r.rows[0] ? r.rows[0].body : '');
        await c.end();
      })().catch((e) => { console.error(e); process.exit(1); });
    `;
    const body = runNodeScript(script, 30_000);
    if (body?.trim()) writeFileSync(mirrorPath, body, 'utf8');
  } catch {
    /* empty start */
  }
  const store = new PostgresJsonStore(url, mirrorPath);
  // dual-write now that connection url is set
  store.persist();
  return store;
}

export function openDocumentStoreSync(opts: OpenStoreOptions): JsonStore {
  const resolved = resolveStoreBackend(opts);
  if (resolved.kind === 'postgres') {
    return openPostgresDocumentStore(resolved.url ?? '');
  }
  if (resolved.kind === 'sqlite') {
    const path = resolved.path ?? 'ysk.sqlite';
    const sqlitePath = path.endsWith('.json')
      ? path.replace(/\.json$/, '.sqlite')
      : path.endsWith('.sqlite') || path.endsWith('.db')
        ? path
        : `${path}.sqlite`;
    return openSqliteDocumentStore(sqlitePath);
  }
  let jsonPath = resolved.path ?? 'ysk.json';
  if (jsonPath.endsWith('.sqlite')) jsonPath = jsonPath.replace(/\.sqlite$/, '.json');
  if (jsonPath.endsWith('.db')) jsonPath = jsonPath.replace(/\.db$/, '.json');
  return new JsonStore(jsonPath);
}

export async function openDocumentStore(opts: OpenStoreOptions): Promise<JsonStore> {
  return openDocumentStoreSync(opts);
}

export function exportStoreDocument(
  db: YskDatabase,
  outPath: string,
): { ok: true; path: string; bytes: number } {
  ensureParent(outPath);
  const body = JSON.stringify(db.snapshot, null, 2);
  const tmp = `${outPath}.${process.pid}.tmp`;
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, outPath);
  return { ok: true, path: outPath, bytes: Buffer.byteLength(body) };
}

export function importStoreDocument(
  db: YskDatabase,
  inPath: string,
): { ok: true; users: number; projects: number } {
  if (!existsSync(inPath)) {
    throw new YskError(ErrorCodes.NOT_FOUND, `import file not found: ${inPath}`, {
      httpStatus: 404,
    });
  }
  const raw = JSON.parse(readFileSync(inPath, 'utf8')) as StoreData;
  const snap = db.snapshot as unknown as Record<string, unknown>;
  for (const k of Object.keys(snap)) {
    delete snap[k];
  }
  Object.assign(snap, raw);
  db.persist();
  return {
    ok: true,
    users: Array.isArray(db.snapshot.users) ? db.snapshot.users.length : 0,
    projects: Array.isArray(db.snapshot.projects) ? db.snapshot.projects.length : 0,
  };
}

export function storeStatus(
  db: YskDatabase,
  locationHint?: string,
): {
  ok: true;
  kind: StoreBackendKind;
  location: string;
  users: number;
  projects: number;
  notes: string[];
} {
  let kind: StoreBackendKind = 'json';
  let location = locationHint ?? '(json)';
  if (db instanceof ShellSqliteJsonStore) {
    kind = 'sqlite';
    location = db.sqlitePath;
  } else if (db instanceof PostgresJsonStore) {
    kind = 'postgres';
    location = db.connectionUrl.replace(/:[^:@/]+@/, ':***@');
  }
  return {
    ok: true,
    kind,
    location,
    users: db.snapshot.users?.length ?? 0,
    projects: db.snapshot.projects?.length ?? 0,
    notes: [
      kind === 'json'
        ? 'JSON atomic file store (default, no native deps)'
        : kind === 'sqlite'
          ? 'SQLite document store via sql.js (pure JS, portable)'
          : 'Postgres document store (experimental, requires pg)',
      'Document mode — not full per-table relational schema (schema.ts reserved)',
    ],
  };
}
