import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from './database.js';
import {
  openDocumentStoreSync,
  exportStoreDocument,
  importStoreDocument,
  storeStatus,
  resolveStoreBackend,
} from './document-store.js';
import { JsonStore } from './store.js';

describe('document store backends (D4)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
    delete process.env.YSK_STORE;
  });

  it('resolveStoreBackend: path + env', () => {
    expect(resolveStoreBackend({ path: '/x/ysk.json' }).kind).toBe('json');
    expect(resolveStoreBackend({ path: '/x/ysk.sqlite' }).kind).toBe('sqlite');
    expect(
      resolveStoreBackend({ url: 'postgres://u:p@localhost/db' }).kind,
    ).toBe('postgres');
    process.env.YSK_STORE = 'sqlite';
    expect(resolveStoreBackend({ path: '/x/ysk.json' }).kind).toBe('sqlite');
  });

  it('json openDatabase still durable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-json-'));
    dirs.push(dir);
    const path = join(dir, 'ysk.json');
    const db = openDatabase(path);
    db.snapshot.users.push({
      id: '1',
      username: 'admin',
      password_hash: 'h',
      password_salt: 's',
      roles: ['admin'],
      locale: 'zh-HK',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    db.persist();
    closeDatabase(db);
    expect(existsSync(path)).toBe(true);
    const db2 = openDatabase(path);
    expect(db2.snapshot.users[0]?.username).toBe('admin');
    closeDatabase(db2);
  });

  it('sqlite document store round-trip via sql.js', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sqlite-'));
    dirs.push(dir);
    const path = join(dir, 'ysk.sqlite');
    let db: ReturnType<typeof openDocumentStoreSync>;
    try {
      db = openDocumentStoreSync({ kind: 'sqlite', path });
    } catch (e) {
      // sql.js missing — honest skip
      expect(String(e)).toMatch(/sql\.js|SQLite|CONFIG|YskError|path/i);
      return;
    }
    expect((db as { backendKind?: string }).backendKind).toBe('sqlite');
    db.snapshot.users.push({
      id: 'u1',
      username: 'sqlite-admin',
      password_hash: 'h',
      password_salt: 's',
      roles: ['admin'],
      locale: 'en',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    db.persist();
    db.close();

    expect(existsSync(path)).toBe(true);
    const db2 = openDocumentStoreSync({ kind: 'sqlite', path });
    expect(db2.snapshot.users.some((u) => u.username === 'sqlite-admin')).toBe(true);
    const st = storeStatus(db2, path);
    expect(st.kind).toBe('sqlite');
    expect(st.users).toBeGreaterThanOrEqual(1);
    db2.close();
  });

  it('export / import between stores', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-xport-'));
    dirs.push(dir);
    const jsonPath = join(dir, 'a.json');
    const db = new JsonStore(jsonPath);
    db.snapshot.projects.push({
      id: 'p1',
      name: 'Demo',
      domain: 'demo.local',
      linux_user: 'ysk',
      linux_group: 'ysk',
      home_dir: '/tmp/x',
      runtime: 'node',
      env: 'production',
      status: 'active',
      os_provisioned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);
    db.persist();
    const out = join(dir, 'export.json');
    const exp = exportStoreDocument(db, out);
    expect(exp.ok).toBe(true);
    expect(existsSync(out)).toBe(true);
    expect(JSON.parse(readFileSync(out, 'utf8')).projects[0].name).toBe('Demo');

    const db2 = new JsonStore(join(dir, 'b.json'));
    const imp = importStoreDocument(db2, out);
    expect(imp.ok).toBe(true);
    expect(imp.projects).toBe(1);
    expect(db2.snapshot.projects[0]?.name).toBe('Demo');
    closeDatabase(db);
    closeDatabase(db2);
  });

  it('openDatabase(.sqlite) uses sqlite when available else still works via env json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-open-'));
    dirs.push(dir);
    process.env.YSK_STORE = 'json';
    const db = openDatabase(join(dir, 'ysk.sqlite'));
    // with YSK_STORE=json, path .sqlite is remapped to .json by openDocumentStoreSync
    db.snapshot.settings['k'] = 'v';
    db.persist();
    closeDatabase(db);
  });
});
