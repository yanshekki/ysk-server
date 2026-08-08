import { describe, expect, it } from 'vitest';
import {
  filenameFromDisposition,
  formatBytes,
  progressPercent,
} from './PublicSharePage';

describe('PublicSharePage helpers', () => {
  it('filenameFromDisposition parses RFC5987 and quoted names', () => {
    expect(
      filenameFromDisposition(
        "attachment; filename*=UTF-8''hello%20world.mp4",
        'fallback',
      ),
    ).toBe('hello world.mp4');
    expect(
      filenameFromDisposition('attachment; filename="clip.mp4"', 'fallback'),
    ).toBe('clip.mp4');
    expect(filenameFromDisposition(null, 'fallback')).toBe('fallback');
  });

  it('formatBytes scales units', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toMatch(/KB/);
    expect(formatBytes(5 * 1024 * 1024)).toMatch(/MB/);
  });

  it('progressPercent clamps and handles missing total', () => {
    expect(progressPercent(50, 100)).toBe(50);
    expect(progressPercent(120, 100)).toBe(100);
    expect(progressPercent(10, null)).toBeNull();
    expect(progressPercent(0, 0)).toBeNull();
  });
});
