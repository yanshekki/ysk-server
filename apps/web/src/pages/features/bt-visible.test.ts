import { describe, expect, it } from 'vitest';
import { btLeftoverHashes, btVisibleAndLeftover, isListenAll } from './BtTrackerPage';

describe('btVisibleAndLeftover', () => {
  it('counts library/share rows, not tracker swarm leftovers', () => {
    expect(
      btVisibleAndLeftover({
        library: [],
        swarm: [],
        trackerTorrents: 1,
      }),
    ).toEqual({ visible: 0, leftover: 1 });

    expect(
      btVisibleAndLeftover({
        library: [{ infoHash: 'aa'.repeat(20) }],
        swarm: [{ infoHash: 'aa'.repeat(20), kind: 'library' }],
        trackerTorrents: 1,
      }),
    ).toEqual({ visible: 1, leftover: 0 });

    expect(
      btVisibleAndLeftover({
        library: [],
        swarm: [{ infoHash: 'bb'.repeat(20), kind: 'share' }],
        trackerTorrents: 1,
      }),
    ).toEqual({ visible: 1, leftover: 0 });
  });
});

describe('btLeftoverHashes', () => {
  it('lists tracker hashes that are not library rows', () => {
    expect(
      btLeftoverHashes({
        library: [{ infoHash: 'aa'.repeat(20) }],
        swarm: [
          { infoHash: 'aa'.repeat(20), kind: 'library' },
          { infoHash: 'bb'.repeat(20), kind: 'library' },
          { infoHash: 'cc'.repeat(20), kind: 'share' },
          { infoHash: 'dd'.repeat(20), kind: 'swarm' },
        ],
      }),
    ).toEqual(['bb'.repeat(20), 'dd'.repeat(20)]);
  });
});

describe('isListenAll', () => {
  it('treats 0.0.0.0 and empty as all-interfaces', () => {
    expect(isListenAll('0.0.0.0')).toBe(true);
    expect(isListenAll('')).toBe(true);
    expect(isListenAll('127.0.0.1')).toBe(false);
  });
});
