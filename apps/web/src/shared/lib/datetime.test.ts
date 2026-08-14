import { describe, expect, it } from 'vitest';
import { formatDateTime } from './datetime';

describe('formatDateTime', () => {
  it('returns em dash for empty', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('')).toBe('—');
  });

  it('formats an ISO instant in a given zone', () => {
    const out = formatDateTime('2026-08-14T15:59:06.597Z', {
      locale: 'zh-HK',
      timeZone: 'Europe/Vilnius',
    });
    expect(out).not.toBe('—');
    expect(out).toMatch(/2026/);
  });
});
