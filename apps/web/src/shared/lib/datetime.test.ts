import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTime } from './datetime';
import { setHostTimeZone } from './host-timezone';

afterEach(() => {
  setHostTimeZone(null);
});

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
    expect(out).toBe('2026-08-14 18:59:06 UTC+3');
  });

  it('never uses a 12-hour clock', () => {
    const out = formatDateTime('2026-08-15T03:18:24.000Z', {
      timeZone: 'UTC',
    });
    expect(out).toBe('2026-08-15 03:18:24 UTC');
    expect(out).not.toMatch(/AM|PM|上午|下午/i);
  });

  it('treats naive timestamps as UTC and can append an offset', () => {
    const out = formatDateTime('2026-08-16 03:14:01', { timeZone: 'UTC', withOffset: true });
    expect(out).toBe('2026-08-16 03:14:01 UTC');
  });

  it('defaults to the host timezone when the caller omits timeZone', () => {
    setHostTimeZone('Asia/Hong_Kong');
    expect(formatDateTime('2026-08-17T09:10:01.000Z', { withOffset: false })).toBe(
      '2026-08-17 17:10:01',
    );
    expect(formatDateTime('2026-08-17T09:10:01.000Z')).toBe('2026-08-17 17:10:01 UTC+8');
  });

  it('keeps an explicit UTC zone even when the host zone is set', () => {
    setHostTimeZone('Asia/Hong_Kong');
    expect(formatDateTime('2026-08-17T09:10:01.000Z', { timeZone: 'UTC', withOffset: false })).toBe(
      '2026-08-17 09:10:01',
    );
    expect(formatDateTime('2026-08-17T09:10:01.000Z', { timeZone: 'UTC' })).toBe(
      '2026-08-17 09:10:01 UTC',
    );
  });
});
