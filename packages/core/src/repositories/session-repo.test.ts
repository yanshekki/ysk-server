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

  it('listPublic + deleteByIdPrefix + deleteOthers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sess2-'));
    const db = openDatabase(join(dir, 'db.json'));
    const repo = new SessionRepository(db);
    const future = new Date(Date.now() + 3600_000).toISOString();
    const now = new Date().toISOString();
    repo.insert({
      token: 'abcdefghijkl-sess-a',
      user_id: 'u1',
      expires_at: future,
      created_at: now,
      ip: '1.1.1.1',
      user_agent: 'cli-test',
    });
    repo.insert({
      token: 'mnopqrstuvwx-sess-b',
      user_id: 'u1',
      expires_at: future,
      created_at: now,
    });
    repo.insert({
      token: 'zzzzzzzzzzzz-other-user',
      user_id: 'u2',
      expires_at: future,
      created_at: now,
    });

    const pub = repo.listPublic('u1', 'abcdefghijkl-sess-a');
    expect(pub).toHaveLength(2);
    expect(pub.find((s) => s.current)?.id).toBe('abcdefghijkl');
    expect(pub[0]!.id.length).toBe(12);

    expect(repo.deleteByIdPrefix('u1', 'mnopqrstuvwx')).toBe(true);
    expect(repo.listByUser('u1')).toHaveLength(1);

    const n = repo.deleteOthers('u1', 'abcdefghijkl-sess-a');
    expect(n).toBe(0); // only current left
    // add another then wipe others
    repo.insert({
      token: 'qqqqqqqqqqqq-extra',
      user_id: 'u1',
      expires_at: future,
      created_at: now,
    });
    expect(repo.deleteOthers('u1', 'abcdefghijkl-sess-a')).toBe(1);
    expect(repo.listByUser('u1')).toHaveLength(1);
    // other user untouched
    expect(repo.find('zzzzzzzzzzzz-other-user')).toBeTruthy();

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
