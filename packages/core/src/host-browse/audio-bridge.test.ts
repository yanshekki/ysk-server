import { describe, expect, it } from 'vitest';
import { AUDIO_BRIDGE_BOOTSTRAP, decodePcmB64 } from './audio-bridge.js';

describe('audio-bridge', () => {
  it('bootstrap injects queue + capture hooks', () => {
    expect(AUDIO_BRIDGE_BOOTSTRAP).toContain('__yskAudioQ');
    expect(AUDIO_BRIDGE_BOOTSTRAP).toContain('captureStream');
  });

  it('decodes base64 pcm', () => {
    const buf = decodePcmB64(Buffer.from([0, 1, 2, 3]).toString('base64'));
    expect(buf.length).toBe(4);
  });
});
