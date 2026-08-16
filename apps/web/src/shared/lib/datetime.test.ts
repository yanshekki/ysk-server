import { describe, expect, it } from 'vitest';
import { formatDateTime } from './datetime';

describe('formatDateTime', () => {
  it('returns em dash for empty', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('')).toBe('—');
  });

  it('formats an ISO instant as 24-hour YYYY-MM-DD HH:mm:ss', () => {
    const out = formatDateTime('2026-08-14T15:59:06.597Z', {
      locale: 'zh-HK',
      timeZone: 'Europe/Vilnius',
    });
    expect(out).toBe('2026-08-14 18:59:06');
  });

  it('never uses a 12-hour clock', () => {
    const out = formatDateTime('2026-08-15T03:18:24.000Z', {
      timeZone: 'UTC',
    });
    expect(out).toBe('2026-08-15 03:18:24');
    expect(out).not.toMatch(/AM|PM|上午|下午/i);
  });
});
