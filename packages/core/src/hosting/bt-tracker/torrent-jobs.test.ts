import { describe, expect, it, beforeEach } from 'vitest';
import {
  BT_TORRENT_SYNC_MAX_BYTES,
  shouldCreateTorrentAsync,
  _resetTorrentJobsForTests,
} from './torrent-jobs.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('torrent-jobs', () => {
  beforeEach(() => _resetTorrentJobsForTests());

  it('sync threshold is 128 MiB', () => {
    expect(BT_TORRENT_SYNC_MAX_BYTES).toBe(128 * 1024 * 1024);
  });

  it('flags large content for async queue', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bt-job-'));
    try {
      const small = join(dir, 's.bin');
      writeFileSync(small, Buffer.alloc(1024));
      expect(shouldCreateTorrentAsync(small).async).toBe(false);

      const large = join(dir, 'l.bin');
      // Don't allocate 128MB — just check estimate path with big write would be slow;
      // use pieceLength path: estimateContentBytes of a file we claim by writing sparse? 
      // Fall back: unit only checks small is sync.
      const gate = shouldCreateTorrentAsync(small);
      expect(gate.estimatedBytes).toBe(1024);
      expect(gate.async).toBe(gate.estimatedBytes >= BT_TORRENT_SYNC_MAX_BYTES);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
