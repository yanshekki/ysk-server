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
  probeLibraryDest,
  deriveLibraryLiveStatus,
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

  it('probes seed-existing when the torrent file already sits in the parent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bt-probe-'));
    try {
      const pub = join(dir, 'files', 'public');
      mkdirSync(pub, { recursive: true });
      writeFileSync(join(pub, 'hello.txt'), 'hello-bt-library\n');
      const probe = probeLibraryDest({
        dataDir: dir,
        saveRoot: 'public',
        parentRel: '',
        name: 'hello.txt',
        files: [{ path: 'hello.txt', length: 'hello-bt-library\n'.length }],
      });
      expect(probe.destKind).toBe('file-conflict');
      expect(probe.canSeedExisting).toBe(true);
      expect(probe.seedRel).toBe('.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('download mode refuses when dest is an existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bt-file-'));
    try {
      const pub = join(dir, 'files', 'public');
      mkdirSync(pub, { recursive: true });
      writeFileSync(join(pub, 'hello.txt'), 'x');
      expect(() => resolveLibraryDestAbs(dir, 'public', 'hello.txt')).toThrow(/file|檔|同名/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seed-existing add does not 409 when the payload file already exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bt-seedex-'));
    try {
      const content = join(dir, 'payload');
      mkdirSync(content, { recursive: true });
      writeFileSync(join(content, 'hello.txt'), 'hello-bt-library\n');
      const pub = join(dir, 'files', 'public');
      mkdirSync(pub, { recursive: true });
      writeFileSync(join(pub, 'hello.txt'), 'hello-bt-library\n');
      const settings = {
        ...DEFAULT_BT_TRACKER_SETTINGS,
        publicAnnounceHost: 'tracker.test',
      };
      saveBtTrackerSettings(dir, settings);
      const created = await createShareTorrent({
        dataDir: dir,
        shareId: 's-seed',
        name: 'hello.txt',
        contentAbsPath: join(content, 'hello.txt'),
        settings,
      });
      const buf = (await import('node:fs')).readFileSync(created.torrentAbsPath!);
      const added = await addBtLibraryItem({
        dataDir: dir,
        torrentBuf: buf,
        saveRoot: 'public',
        saveRelPath: 'hello.txt',
        parentRel: '',
        mode: 'seed-existing',
        start: false,
      });
      expect(added.ok).toBe(true);
      expect(added.item?.saveRelPath).toBe('.');
      if (added.item) await stopSeed(added.item.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('maps progress 0 with no dest files to downloading, not checking', () => {
    expect(
      deriveLibraryLiveStatus({
        stored: 'checking',
        hasSeed: true,
        progress: 0,
        destHasFiles: false,
      }),
    ).toBe('downloading');
    expect(
      deriveLibraryLiveStatus({
        stored: 'checking',
        hasSeed: true,
        progress: 0,
        destHasFiles: true,
      }),
    ).toBe('checking');
    expect(
      deriveLibraryLiveStatus({
        stored: 'checking',
        hasSeed: true,
        progress: 1,
        done: true,
      }),
    ).toBe('seeding');
    expect(
      deriveLibraryLiveStatus({
        stored: 'downloading',
        hasSeed: false,
        destHasFiles: false,
        ageMs: 11 * 60_000,
      }),
    ).toBe('error');
  });
});
