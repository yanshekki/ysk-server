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
  normalizeDownloadModes,
} from './shares.js';
import { createHash } from 'node:crypto';
import { hashSharePassword, verifySharePasswordHash } from './manager.js';

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
      expect(s.passwordHash).toMatch(/^scrypt\$[a-f0-9]+\$[a-f0-9]+$/);
      expect(verifySharePassword(s, undefined)).toBe(false);
      expect(verifySharePassword(s, 'secret12')).toBe(true);
      expect(verifySharePassword(s, 'wrong')).toBe(false);
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

  it('normalizes download modes (direct | bt | both)', () => {
    expect(normalizeDownloadModes(undefined)).toEqual(['direct']);
    expect(normalizeDownloadModes('bt')).toEqual(['bt']);
    expect(normalizeDownloadModes('both')).toEqual(['direct', 'bt']);
    expect(normalizeDownloadModes(['direct', 'bt'])).toEqual(['direct', 'bt']);
    expect(normalizeDownloadModes('direct|bt')).toEqual(['direct', 'bt']);
  });

  it('creates BT-mode share with pending seed status', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-shares-bt-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      const s = createFileShare(store, {
        root: 'public',
        path: 'big.bin',
        createdBy: 'admin',
        downloadModes: ['bt'],
        seedStatus: 'pending',
      });
      expect(s.downloadModes).toEqual(['bt']);
      expect(s.seedStatus).toBe('pending');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifies scrypt and legacy SHA-256 share password hashes', () => {
    const scrypt = hashSharePassword('new-pass');
    expect(scrypt.startsWith('scrypt$')).toBe(true);
    expect(verifySharePasswordHash(scrypt, 'new-pass')).toBe(true);
    expect(verifySharePasswordHash(scrypt, 'nope')).toBe(false);

    const legacy = createHash('sha256').update('old-pass').digest('hex');
    expect(verifySharePasswordHash(legacy, 'old-pass')).toBe(true);
    expect(verifySharePasswordHash(legacy, 'nope')).toBe(false);
  });
});
