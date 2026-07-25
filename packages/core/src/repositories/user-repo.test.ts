import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { UserRepository } from './user-repo.js';

describe('UserRepository', () => {
  it('inserts and finds users', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-user-'));
    const db = openDatabase(join(dir, 'db.json'));
    const repo = new UserRepository(db);
    expect(repo.count()).toBe(0);
    repo.insert({
      id: 'u1',
      username: 'admin',
      password_hash: 'h',
      password_salt: 's',
      roles: ['admin'],
      locale: 'zh-TW',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(repo.count()).toBe(1);
    expect(repo.findByUsername('admin')?.id).toBe('u1');
    expect(repo.findById('u1')?.username).toBe('admin');
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
