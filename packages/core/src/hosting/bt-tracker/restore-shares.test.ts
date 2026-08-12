import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import { createFileShare, listFileShares, patchFileShare } from '../../files/shares.js';
import { publicFilesRoot } from '../../files/manager.js';
import { restoreBtSharesOnBoot } from './restore-shares.js';
import type { HostExecutor } from '../../host/executor.js';

function mockHost(): HostExecutor {
  return {
    executeEnabled: () => true,
    isRoot: () => false,
  } as HostExecutor;
}

describe('restoreBtSharesOnBoot', () => {
  it('skips shares without torrent file and reports counts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bt-restore-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      const pub = publicFilesRoot(dir);
      mkdirSync(pub, { recursive: true });
      writeFileSync(join(pub, 'a.bin'), 'hello-bt');
      const s = createFileShare(store, {
        root: 'public',
        path: 'a.bin',
        createdBy: 'admin',
        downloadModes: ['bt'],
        seedStatus: 'pending',
      });
      // no torrentRelPath → skip
      const r = await restoreBtSharesOnBoot({
        dataDir: dir,
        db: store,
        host: mockHost(),
      });
      expect(r.attempted).toBe(0);
      expect(r.skipped).toBeGreaterThanOrEqual(1);
      // still may start tracker if autostart or shares present
      expect(typeof r.trackerRunning).toBe('boolean');
      const row = listFileShares(store).find((x) => x.id === s.id);
      expect(row).toBeTruthy();
    } finally {
      try {
        const { stopBtTracker } = await import('./service.js');
        await stopBtTracker();
      } catch {
        /* */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('re-seeds when torrent + content exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bt-restore2-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      const pub = publicFilesRoot(dir);
      mkdirSync(pub, { recursive: true });
      writeFileSync(join(pub, 'b.bin'), 'payload-for-seed');
      const s = createFileShare(store, {
        root: 'public',
        path: 'b.bin',
        createdBy: 'admin',
        downloadModes: ['bt'],
        seedStatus: 'pending',
      });
      // Minimal fake .torrent is not enough for webtorrent — mark path present and
      // expect either seed attempt failure (parse) or skip gracefully.
      const torDir = join(dir, 'files', 'torrents');
      mkdirSync(torDir, { recursive: true });
      writeFileSync(join(torDir, `${s.id}.torrent`), 'not-a-real-torrent');
      patchFileShare(store, s.id, {
        torrentRelPath: `files/torrents/${s.id}.torrent`,
        infoHash: 'a'.repeat(40),
      });
      const r = await restoreBtSharesOnBoot({
        dataDir: dir,
        db: store,
        host: mockHost(),
      });
      expect(r.attempted).toBe(1);
      // Invalid torrent should fail seed, not hang
      expect(r.seeded + r.failed).toBe(1);
    } finally {
      try {
        const { stopBtTracker } = await import('./service.js');
        await stopBtTracker();
      } catch {
        /* */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
