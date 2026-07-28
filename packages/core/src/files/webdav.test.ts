import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import {
  getWebDavSettings,
  setWebDavSettings,
  issueWebDavToken,
  verifyWebDavToken,
  buildPropfindResponse,
} from './webdav.js';

describe('webdav', () => {
  it('settings token and propfind xml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-webdav-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      expect(getWebDavSettings(db).enabled).toBe(false);
      setWebDavSettings(db, { mountPath: '/dav' });
      expect(getWebDavSettings(db).mountPath).toBe('/dav');
      const issued = issueWebDavToken(db);
      expect(issued.token.length).toBeGreaterThan(10);
      expect(verifyWebDavToken(db, issued.token)).toBe(true);
      expect(verifyWebDavToken(db, 'wrong')).toBe(false);
      const xml = buildPropfindResponse({
        href: '/dav/',
        entries: [
          {
            name: 'a.txt',
            href: '/dav/a.txt',
            isDir: false,
            size: 3,
            mtime: 'Wed, 01 Jan 2026 00:00:00 GMT',
          },
        ],
      });
      expect(xml).toContain('multistatus');
      expect(xml).toContain('a.txt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
