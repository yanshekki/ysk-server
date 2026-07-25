import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from './database.js';

describe('openDatabase', () => {
  it('creates durable store and reloads data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-db-'));
    const path = join(dir, 'ysk.sqlite');
    const db = openDatabase(path);
    db.snapshot.users.push({
      id: '1',
      username: 'a',
      password_hash: 'h',
      password_salt: 's',
      roles: ['admin'],
      locale: 'zh-TW',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    db.persist();
    closeDatabase(db);
    const jsonPath = path.replace(/\.sqlite$/, '.json');
    expect(existsSync(jsonPath)).toBe(true);
    const db2 = openDatabase(path);
    expect(db2.snapshot.users).toHaveLength(1);
    expect(db2.snapshot.users[0].username).toBe('a');
    closeDatabase(db2);
    rmSync(dir, { recursive: true, force: true });
  });
});
