import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { SessionRepository } from './session-repo.js';

describe('SessionRepository', () => {
  it('inserts, finds, deletes, and prunes expired', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sess-'));
    const db = openDatabase(join(dir, 'db.json'));
    const repo = new SessionRepository(db);
    const now = new Date();
    const past = new Date(now.getTime() - 60_000).toISOString();
    const future = new Date(now.getTime() + 3600_000).toISOString();
    repo.insert({
      token: 'tok-live',
      user_id: 'u1',
      expires_at: future,
      created_at: now.toISOString(),
    });
    repo.insert({
      token: 'tok-dead',
      user_id: 'u1',
      expires_at: past,
      created_at: past,
    });
    expect(repo.find('tok-live')?.user_id).toBe('u1');
    repo.deleteExpired(now.toISOString());
    expect(repo.find('tok-dead')).toBeUndefined();
    expect(repo.find('tok-live')).toBeTruthy();
    repo.delete('tok-live');
    expect(repo.find('tok-live')).toBeUndefined();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
