import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_BT_TRACKER_SETTINGS } from 'ysk-server-shared';
import {
  buildMagnetUri,
  createShareTorrent,
  estimateContentBytes,
  pickPieceLength,
  rebuildShareMagnetUri,
} from './torrent-create.js';

describe('torrent-create', () => {
  it('picks larger pieces for bigger payloads', () => {
    expect(pickPieceLength(1024)).toBe(16 * 1024);
    expect(pickPieceLength(20 * 1024 * 1024)).toBe(256 * 1024);
    expect(pickPieceLength(100 * 1024 * 1024)).toBe(512 * 1024);
    expect(pickPieceLength(600 * 1024 * 1024)).toBe(1 * 1024 * 1024);
    expect(pickPieceLength(3 * 1024 ** 3)).toBe(2 * 1024 * 1024);
    expect(pickPieceLength(10 * 1024 ** 3)).toBe(4 * 1024 * 1024);
  });

  it('estimates file and folder sizes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bt-est-'));
    try {
      writeFileSync(join(dir, 'a.txt'), 'hello');
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'sub', 'b.txt'), 'world!!');
      expect(estimateContentBytes(join(dir, 'a.txt'))).toBe(5);
      expect(estimateContentBytes(dir)).toBe(5 + 7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates a real .torrent for a file via create-torrent', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-bt-tor-'));
    try {
      const content = join(dataDir, 'payload.bin');
      writeFileSync(content, Buffer.alloc(64 * 1024, 7));
      const r = await createShareTorrent({
        dataDir,
        contentAbsPath: content,
        shareId: 'share1',
        settings: {
          ...DEFAULT_BT_TRACKER_SETTINGS,
          publicAnnounceHost: 'tracker.example:8000',
        },
        name: 'payload.bin',
      });
      expect(r.ok).toBe(true);
      expect(r.infoHash).toMatch(/^[a-f0-9]{40}$/);
      expect(r.magnetUri).toContain('magnet:?');
      expect(r.magnetUri).toContain('tracker.example');
      expect(r.torrentAbsPath && existsSync(r.torrentAbsPath)).toBe(true);
      expect(r.pieceLength).toBeGreaterThan(0);
      expect(r.length).toBe(64 * 1024);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('builds magnets parse-torrent accepts (not URLSearchParams-encoded xt)', async () => {
    const hash = 'a'.repeat(40);
    const broken = (() => {
      const p = new URLSearchParams();
      p.set('xt', `urn:btih:${hash}`);
      p.set('dn', 'test file.mp4');
      p.append('tr', 'ws://tracker.example:8000');
      return `magnet:?${p.toString()}`;
    })();
    // Document the bug we fixed
    expect(broken).toContain('urn%3Abtih%3A');

    const good = buildMagnetUri(hash, 'test file.mp4', [
      'ws://tracker.example:8000',
      'http://tracker.example:8000/announce',
    ]);
    expect(good).toContain('xt=urn:btih:' + hash);
    expect(good).not.toContain('urn%3Abtih%3A');
    expect(good).toContain('tr=' + encodeURIComponent('ws://tracker.example:8000'));

    const parseTorrentMod = await import('parse-torrent');
    const parseTorrent = (parseTorrentMod.default ?? parseTorrentMod) as (
      x: string,
    ) => { infoHash?: string } | Promise<{ infoHash?: string }>;
    await expect(Promise.resolve(parseTorrent(broken))).rejects.toThrow(
      /Invalid torrent identifier/i,
    );
    const parsed = await Promise.resolve(parseTorrent(good));
    expect(String(parsed.infoHash).toLowerCase()).toBe(hash);

    const rebuilt = rebuildShareMagnetUri({
      infoHash: hash,
      name: 'clip.mp4',
      settings: {
        ...DEFAULT_BT_TRACKER_SETTINGS,
        publicAnnounceHost: 'tracker.example.test',
        httpPort: 8000,
        udpPort: 6969,
        wsEnabled: true,
      },
    });
    // tr values are encodeURIComponent'd → tracker.example.test%3A8000
    expect(rebuilt).toMatch(/tracker\.example\.test(%3A|:)8000/);
    expect(rebuilt).toMatch(/ws(%3A%2F%2F|:\/\/)/);
    const p2 = await Promise.resolve(parseTorrent(rebuilt!));
    expect(String(p2.infoHash).toLowerCase()).toBe(hash);
  });

  it('creates a .torrent for a small directory tree', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-bt-dir-'));
    try {
      const folder = join(dataDir, 'tree');
      mkdirSync(join(folder, 'nested'), { recursive: true });
      writeFileSync(join(folder, 'a.txt'), 'aaa');
      writeFileSync(join(folder, 'nested', 'b.txt'), 'bbbb');
      const r = await createShareTorrent({
        dataDir,
        contentAbsPath: folder,
        shareId: 'dirshare',
        settings: DEFAULT_BT_TRACKER_SETTINGS,
        name: 'tree',
      });
      expect(r.ok).toBe(true);
      expect(r.infoHash).toMatch(/^[a-f0-9]{40}$/);
      expect(r.torrentRelPath).toBe('files/torrents/dirshare.torrent');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});
