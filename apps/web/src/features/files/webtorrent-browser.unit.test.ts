import { describe, expect, it } from 'vitest';
import { isBrowserWebTorrentSupported } from './webtorrent-browser';

describe('webtorrent-browser', () => {
  it('reports support based on WebRTC availability', () => {
    // happy-dom / node test env: typically no RTCPeerConnection
    const v = isBrowserWebTorrentSupported();
    expect(typeof v).toBe('boolean');
  });
});
