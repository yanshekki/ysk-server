import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from './store.js';

describe('JsonStore', () => {
  it('creates empty store file and reloads data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-jsonstore-'));
    const path = join(dir, 'store.json');
    const s1 = new JsonStore(path);
    expect(existsSync(path)).toBe(true);
    s1.snapshot.users.push({
      id: 'u1',
      username: 'admin',
      password_hash: 'h',
      password_salt: 's',
      roles: ['admin'],
      locale: 'en',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    s1.snapshot.settings.theme = 'dark';
    s1.persist();
    s1.close();

    const s2 = new JsonStore(path);
    expect(s2.snapshot.users).toHaveLength(1);
    expect(s2.snapshot.users[0]!.username).toBe('admin');
    expect(s2.snapshot.settings.theme).toBe('dark');
    expect(Array.isArray(s2.snapshot.projects)).toBe(true);
    s2.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('atomic write leaves valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-jsonstore-'));
    const path = join(dir, 'store.json');
    const s = new JsonStore(path);
    s.snapshot.settings.k = 'v';
    s.persist();
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect(raw.settings.k).toBe('v');
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
