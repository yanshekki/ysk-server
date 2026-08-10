import { describe, expect, it } from 'vitest';
import {
  clampViewport,
  detectBotChallenge,
  resolveStreamOptions,
  screencastSize,
} from './stream-presets.js';

describe('stream-presets', () => {
  it('resolves balanced defaults', () => {
    const o = resolveStreamOptions();
    expect(o.preset).toBe('balanced');
    expect(o.quality).toBe(80);
    expect(o.everyNthFrame).toBe(1);
  });

  it('sharp is higher quality', () => {
    const o = resolveStreamOptions({ preset: 'sharp' });
    expect(o.quality).toBeGreaterThan(80);
    expect(o.scale).toBeGreaterThan(1);
  });

  it('clamps viewport', () => {
    expect(clampViewport(100, 100)).toEqual({ w: 320, h: 240 });
    expect(clampViewport(5000, 5000).w).toBe(1920);
  });

  it('screencast size respects scale and caps', () => {
    const o = resolveStreamOptions({ preset: 'balanced' });
    const s = screencastSize({ w: 1000, h: 800 }, o);
    expect(s.maxWidth).toBe(1000);
    expect(s.maxHeight).toBe(800);
  });

  it('detects bot challenge titles', () => {
    expect(detectBotChallenge('Just a moment...', 'https://x')).toBe(true);
    expect(detectBotChallenge('Home', 'https://example.com')).toBe(false);
  });
});
