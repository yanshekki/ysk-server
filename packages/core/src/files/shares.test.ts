import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import {
  createFileShare,
  listFileShares,
  deleteFileShare,
  getShareByToken,
  verifySharePassword,
  bumpShareDownload,
  toggleFavorite,
  listFavorites,
} from './shares.js';

describe('file shares', () => {
  it('creates passworded share and favorites', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-shares-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      expect(() =>
        createFileShare(store, { root: 'public', path: '.', createdBy: 'admin' }),
      ).toThrow();
      const s = createFileShare(store, {
        root: 'public',
        path: 'docs/a.txt',
        password: 'secret12',
        createdBy: 'admin',
      });
      expect(listFileShares(store, 'public')).toHaveLength(1);
      expect(getShareByToken(store, s.token)?.path).toBe('docs/a.txt');
      expect(verifySharePassword(s, undefined)).toBe(false);
      expect(verifySharePassword(s, 'secret12')).toBe(true);
      bumpShareDownload(store, s.token);
      expect(listFileShares(store)[0].downloadCount).toBe(1);
      expect(toggleFavorite(store, 'public', 'docs/a.txt').favorited).toBe(true);
      expect(listFavorites(store, 'public')).toHaveLength(1);
      expect(toggleFavorite(store, 'public', 'docs/a.txt').favorited).toBe(false);
      expect(deleteFileShare(store, s.id)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
