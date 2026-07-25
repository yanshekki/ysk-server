import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { SettingsRepository } from './settings-repo.js';

describe('SettingsRepository', () => {
  it('gets and sets string and json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-set-'));
    const db = openDatabase(join(dir, 'db.json'));
    const repo = new SettingsRepository(db);
    expect(repo.get('missing')).toBeUndefined();
    repo.set('k', 'v');
    expect(repo.get('k')).toBe('v');
    repo.setJson('obj', { a: 1 });
    expect(repo.getJson<{ a: number }>('obj')).toEqual({ a: 1 });
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
