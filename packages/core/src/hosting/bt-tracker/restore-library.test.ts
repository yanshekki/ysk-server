import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { upsertBtLibraryItem } from './library.js';
import { restoreBtLibraryOnBoot } from './restore-library.js';

describe('restoreBtLibraryOnBoot', () => {
  it('skips paused items', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bt-restore-lib-'));
    try {
      upsertBtLibraryItem(dir, {
        id: 'paused-1',
        infoHash: 'a'.repeat(40),
        name: 'paused',
        saveRoot: 'public',
        saveRelPath: 'downloads/paused',
        source: 'library',
        status: 'paused',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const r = await restoreBtLibraryOnBoot({ dataDir: dir });
      expect(r.attempted).toBe(0);
      expect(r.skipped).toBe(0);
      expect(r.started).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
