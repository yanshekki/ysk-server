import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import {
  createApiKey,
  deleteApiKey,
  listApiKeys,
  verifyApiKey,
  verifyApiKeyDetailed,
} from './api-keys.js';

describe('api-keys', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function openTmp() {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-apikey-'));
    dirs.push(dir);
    return openDatabase(join(dir, 'ysk.json'));
  }

  it('create → list → verify → delete (full scope)', () => {
    const db = openTmp();
    const { key, token } = createApiKey(db, {
      name: 'ci',
      userId: 'user-1',
      scope: 'full',
    });
    expect(key.id).toBeTruthy();
    expect(key.prefix.startsWith('ysk_')).toBe(true);
    expect(key.scope).toBe('full');
    expect(key.readOnly).toBe(false);
    expect(token.startsWith('ysk_')).toBe(true);
    expect(token.length).toBeGreaterThan(20);

    const listed = listApiKeys(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(key.id);
    // never leak hash/token in public list
    expect(JSON.stringify(listed[0])).not.toMatch(/token_hash/);

    expect(verifyApiKey(db, token)).toBe('user-1');
    const detailed = verifyApiKeyDetailed(db, token);
    expect(detailed).toMatchObject({
      userId: 'user-1',
      scope: 'full',
      readOnly: false,
      keyId: key.id,
    });

    expect(deleteApiKey(db, key.id)).toBe(true);
    expect(listApiKeys(db)).toHaveLength(0);
    expect(verifyApiKey(db, token)).toBeNull();
    expect(deleteApiKey(db, key.id)).toBe(false);
    closeDatabase(db);
  });

  it('read scope is readOnly', () => {
    const db = openTmp();
    const { key, token } = createApiKey(db, {
      name: 'ro',
      userId: 'u2',
      scope: 'read',
    });
    expect(key.scope).toBe('read');
    expect(key.readOnly).toBe(true);
    const d = verifyApiKeyDetailed(db, token);
    expect(d?.readOnly).toBe(true);
    expect(d?.scope).toBe('read');
    closeDatabase(db);
  });

  it('rejects invalid tokens', () => {
    const db = openTmp();
    createApiKey(db, { name: 'x', userId: 'u' });
    expect(verifyApiKey(db, 'not-a-key')).toBeNull();
    expect(verifyApiKey(db, 'ysk_invalid_token_xxxxxxxxxxxx')).toBeNull();
    expect(verifyApiKeyDetailed(db, '')).toBeNull();
    closeDatabase(db);
  });

  it('updates last_used_at on verify', () => {
    const db = openTmp();
    const { token } = createApiKey(db, { name: 't', userId: 'u' });
    expect(listApiKeys(db)[0]!.last_used_at).toBeUndefined();
    verifyApiKey(db, token);
    expect(listApiKeys(db)[0]!.last_used_at).toBeTruthy();
    closeDatabase(db);
  });
});
