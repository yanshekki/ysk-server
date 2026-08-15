import { describe, expect, it } from 'vitest';
import { btVisibleAndLeftover } from './BtTrackerPage';

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
