import { describe, expect, it } from 'vitest';
import { listBtTrackerTorrents } from './service.js';

describe('listBtTrackerTorrents', () => {
  it('merges hints when tracker not running', () => {
    const rows = listBtTrackerTorrents({
      hints: [
        {
          infoHash: 'a'.repeat(40),
          name: 'a.bin',
          shareId: 's1',
          seedStatus: 'seeding',
          seeders: 1,
        },
        {
          infoHash: 'B'.repeat(40),
          name: 'b.bin',
          seeders: 0,
          leechers: 2,
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.infoHash).toBe('a'.repeat(40));
    expect(rows[0]!.name).toBe('a.bin');
    expect(rows[0]!.seeders).toBe(1);
    expect(rows[1]!.infoHash).toBe('b'.repeat(40));
    expect(rows[1]!.leechers).toBe(2);
  });

  it('ignores invalid info hashes in hints', () => {
    const rows = listBtTrackerTorrents({
      hints: [{ infoHash: 'nope', name: 'x' }],
    });
    expect(rows).toHaveLength(0);
  });
});
