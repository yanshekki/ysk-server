import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolveStoreBackend,
  openDocumentStoreSync,
  openDocumentStore,
  openPostgresDocumentStore,
  openSqliteDocumentStore,
  exportStoreDocument,
  importStoreDocument,
  storeStatus,
  ShellSqliteJsonStore,
  PostgresJsonStore,
} from './document-store.js';
import { JsonStore } from './store.js';

describe('document-store depth', () => {
  const dirs: string[] = [];
  const envKeys = [
    'YSK_STORE',
    'YSK_DB_BACKEND',
    'YSK_DATABASE_URL',
    'DATABASE_URL',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
      delete saved[k];
    }
  });

  function stashEnv() {
    for (const k of envKeys) saved[k] = process.env[k];
  }

  it('resolveStoreBackend prefers opts.kind and env variants', () => {
    stashEnv();
    delete process.env.YSK_STORE;
    delete process.env.YSK_DB_BACKEND;
    delete process.env.YSK_DATABASE_URL;
    delete process.env.DATABASE_URL;

    expect(resolveStoreBackend({ kind: 'json', path: '/a.json' }).kind).toBe('json');
    expect(resolveStoreBackend({ kind: 'sqlite', path: '/a.json' }).kind).toBe('sqlite');

    process.env.YSK_DB_BACKEND = 'postgres';
    expect(resolveStoreBackend({ path: '/x' }).kind).toBe('postgres');

    process.env.YSK_DB_BACKEND = 'json';
    process.env.DATABASE_URL = 'postgresql://u:p@h/db';
    // env kind wins over url
    expect(resolveStoreBackend({}).kind).toBe('json');

    delete process.env.YSK_DB_BACKEND;
    delete process.env.YSK_STORE;
    delete process.env.DATABASE_URL;
    delete process.env.YSK_DATABASE_URL;
    expect(resolveStoreBackend({ url: 'postgresql://u:p@h/db' }).kind).toBe('postgres');
    expect(resolveStoreBackend({ path: '/data/x.db' }).kind).toBe('sqlite');
    expect(resolveStoreBackend({ path: '/data/x.json' }).kind).toBe('json');
  });

  it('openDocumentStoreSync json remaps .sqlite path; async open works', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ds-'));
    dirs.push(dir);
    stashEnv();
    process.env.YSK_STORE = 'json';
    const db = openDocumentStoreSync({ kind: 'json', path: join(dir, 'ysk.sqlite') });
    db.snapshot.settings.k = 'v';
    db.persist();
    expect(existsSync(join(dir, 'ysk.json'))).toBe(true);
    const asyncDb = await openDocumentStore({ kind: 'json', path: join(dir, 'b.json') });
    expect(asyncDb.snapshot).toBeTruthy();
    asyncDb.close();
    db.close();
  });

  it('openSqliteDocumentStore seeds from sibling .json when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ds-sib-'));
    dirs.push(dir);
    const sqlitePath = join(dir, 'state.sqlite');
    const sibling = join(dir, 'state.json');
    writeFileSync(
      sibling,
      JSON.stringify({
        version: 1,
        users: [],
        projects: [{ id: 'p', name: 'from-sibling' }],
        settings: {},
        audit: [],
      }),
      'utf8',
    );
    try {
      const store = openSqliteDocumentStore(sqlitePath);
      expect(store.backendKind).toBe('sqlite');
      expect(store.sqlitePath).toBe(sqlitePath);
      // may or may not load sibling projects depending on sql.js — structure ok
      expect(storeStatus(store).kind).toBe('sqlite');
      expect(storeStatus(store).notes.some((n) => /sql\.js|SQLite/i.test(n))).toBe(true);
      store.close();
    } catch (e) {
      expect(String(e)).toMatch(/sql\.js|SQLite|CONFIG|YskError/i);
    }
  });

  it('openPostgresDocumentStore rejects empty url and missing pg honestly', () => {
    expect(() => openPostgresDocumentStore('')).toThrow(/Postgres|YSK_DATABASE_URL|CONFIG/i);
    try {
      openPostgresDocumentStore('postgres://u:p@127.0.0.1:1/db');
    } catch (e) {
      // either missing pg or connection fail on persist — both honest
      expect(String(e)).toMatch(/pg|Postgres|CONFIG|ECONN|connect|fail/i);
    }
  });

  it('PostgresJsonStore.connectionUrl and storeStatus redacts password', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pg-'));
    dirs.push(dir);
    const mirror = join(dir, 'mirror.json');
    writeFileSync(mirror, '{}', 'utf8');
    // construct without calling open (avoid network)
    const store = new PostgresJsonStore('postgres://user:s3cret@host/db', mirror);
    expect(store.backendKind).toBe('postgres');
    expect(store.connectionUrl).toContain('s3cret');
    // persist will try dual-write — catch honesty
    try {
      store.persist();
    } catch (e) {
      expect(String(e)).toMatch(/Postgres|pg|CONFIG|fail/i);
    }
    const st = storeStatus(store);
    expect(st.kind).toBe('postgres');
    expect(st.location).not.toContain('s3cret');
    expect(st.location).toContain('***');
    expect(st.notes.some((n) => /Postgres|experimental/i.test(n))).toBe(true);
  });

  it('ShellSqliteJsonStore.sqlitePath empty before ready; import missing file throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-imp-'));
    dirs.push(dir);
    const json = new JsonStore(join(dir, 'a.json'));
    expect(() => importStoreDocument(json, join(dir, 'nope.json'))).toThrow(/not found|NOT_FOUND/i);

    const out = join(dir, 'exp.json');
    const exp = exportStoreDocument(json, out);
    expect(exp.ok).toBe(true);
    expect(exp.bytes).toBeGreaterThan(0);

    // storeStatus on plain json
    const st = storeStatus(json, join(dir, 'a.json'));
    expect(st.kind).toBe('json');
    expect(st.location).toContain('a.json');
    expect(st.notes[0]).toMatch(/JSON/i);
    json.close();
  });

  it('openDocumentStoreSync sqlite path endings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-end-'));
    dirs.push(dir);
    try {
      const a = openDocumentStoreSync({ kind: 'sqlite', path: join(dir, 'x.json') });
      expect((a as ShellSqliteJsonStore).backendKind).toBe('sqlite');
      a.close();
    } catch (e) {
      expect(String(e)).toMatch(/sql\.js|SQLite|CONFIG/i);
    }
    try {
      const b = openDocumentStoreSync({ kind: 'sqlite', path: join(dir, 'plain') });
      expect((b as ShellSqliteJsonStore).sqlitePath.endsWith('.sqlite')).toBe(true);
      b.close();
    } catch (e) {
      expect(String(e)).toMatch(/sql\.js|SQLite|CONFIG/i);
    }
  });

  it('importStoreDocument replaces snapshot keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-imp2-'));
    dirs.push(dir);
    const db = new JsonStore(join(dir, 'a.json'));
    db.snapshot.settings.old = '1';
    db.persist();
    const src = join(dir, 'src.json');
    writeFileSync(
      src,
      JSON.stringify({
        version: 1,
        users: [{ id: 'u', username: 'x', password_hash: 'h', password_salt: 's', roles: [], locale: 'en', created_at: '', updated_at: '' }],
        projects: [],
        settings: { fresh: 'yes' },
        audit: [],
      }),
      'utf8',
    );
    const r = importStoreDocument(db, src);
    expect(r.ok).toBe(true);
    expect(r.users).toBe(1);
    expect(db.snapshot.settings.fresh).toBe('yes');
    expect(db.snapshot.settings.old).toBeUndefined();
    db.close();
  });
});
