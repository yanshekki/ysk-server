import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createShareTorrent } from './torrent-create.js';
import {
  inspectTorrentInput,
  sanitizeSaveRelPath,
  sanitizeTorrentFolderName,
  resolveLibraryDestAbs,
  addBtLibraryItem,
  MAX_TORRENT_BYTES,
} from './library-ops.js';
import { getBtLibraryByHash, loadBtLibrary } from './library.js';
import { DEFAULT_BT_TRACKER_SETTINGS } from 'ysk-server-shared';
import { saveBtTrackerSettings } from './settings.js';
import { stopSeed } from './seeder.js';

describe('bt library dest + inspect', () => {
  it('sanitizes dest paths and folder names', () => {
    expect(sanitizeSaveRelPath('downloads/foo')).toBe('downloads/foo');
    expect(sanitizeSaveRelPath('/downloads/../foo')).toBe('downloads/foo');
    expect(() => sanitizeSaveRelPath('..')).toThrow();
    expect(sanitizeSaveRelPath('../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeTorrentFolderName('a/b:c')).toBe('a_b_c');
  });

  it('mkdir dest under public files root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bt-lib-'));
    try {
      const r = resolveLibraryDestAbs(dir, 'public', 'downloads/demo');
      expect(r.saveRelPath).toBe('downloads/demo');
      expect(r.destAbs).toContain('files/public/downloads/demo');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('inspects a real .torrent and refuses a duplicate add', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bt-insp-'));
    try {
      const content = join(dir, 'payload');
      mkdirSync(content, { recursive: true });
      writeFileSync(join(content, 'hello.txt'), 'hello-bt-library\n');
      const settings = {
        ...DEFAULT_BT_TRACKER_SETTINGS,
        publicAnnounceHost: 'tracker.test',
      };
      saveBtTrackerSettings(dir, settings);
      const created = await createShareTorrent({
        dataDir: dir,
        shareId: 's1',
        name: 'hello-lib',
        contentAbsPath: join(content, 'hello.txt'),
        settings,
      });
      expect(created.ok).toBe(true);
      const buf = (await import('node:fs')).readFileSync(created.torrentAbsPath!);
      const inspected = await inspectTorrentInput({ torrentBuf: buf });
      expect(inspected.infoHash).toMatch(/^[a-f0-9]{40}$/);
      expect(inspected.name).toBeTruthy();

      const added = await addBtLibraryItem({
        dataDir: dir,
        torrentBuf: buf,
        saveRoot: 'public',
        saveRelPath: `downloads/${sanitizeTorrentFolderName(inspected.name)}`,
      });
      expect(added.ok || added.item?.status === 'queued' || added.item?.status === 'error').toBe(
        true,
      );
      expect(loadBtLibrary(dir)).toHaveLength(1);
      expect(getBtLibraryByHash(dir, inspected.infoHash)?.infoHash).toBe(inspected.infoHash);
      if (added.item) await stopSeed(added.item.id);

      await expect(
        addBtLibraryItem({
          dataDir: dir,
          torrentBuf: buf,
          saveRoot: 'public',
          saveRelPath: 'downloads/other',
        }),
      ).rejects.toMatchObject({ httpStatus: 409 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('rejects oversize torrent buffers', async () => {
    const huge = Buffer.alloc(MAX_TORRENT_BYTES + 1);
    await expect(inspectTorrentInput({ torrentBuf: huge })).rejects.toMatchObject({
      httpStatus: 400,
    });
  });

  it('rejects a magnet that is not a magnet', async () => {
    await expect(inspectTorrentInput({ magnet: 'http://example.com' })).rejects.toMatchObject({
      httpStatus: 400,
    });
  });
});
