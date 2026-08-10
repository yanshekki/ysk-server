import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from './database.js';

describe('openDatabase', () => {
  it('creates durable json store and reloads data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-db-'));
    const path = join(dir, 'ysk.json');
    const db = openDatabase(path);
    db.snapshot.users.push({
      id: '1',
      username: 'a',
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
    expect(db2.snapshot.users).toHaveLength(1);
    expect(db2.snapshot.users[0].username).toBe('a');
    closeDatabase(db2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('path ending .sqlite opens sqlite document backend when native available', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-db-sql-'));
    const path = join(dir, 'ysk.sqlite');
    try {
      const db = openDatabase(path, { kind: 'sqlite' });
      db.snapshot.users.push({
        id: '1',
        username: 'sql',
        password_hash: 'h',
        password_salt: 's',
        roles: ['admin'],
        locale: 'zh-HK',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      db.persist();
      closeDatabase(db);
      const db2 = openDatabase(path, { kind: 'sqlite' });
      expect(db2.snapshot.users[0]?.username).toBe('sql');
      closeDatabase(db2);
    } catch (e) {
      // optional sql.js
      expect(String(e)).toMatch(/sql\.js|SQLite|CONFIG|YskError/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
