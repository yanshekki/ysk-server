import { describe, expect, it } from 'vitest';
import { emailHealthUnprobed } from './health-display';

describe('emailHealthUnprobed', () => {
  it('is true when no DNS/PTR/port probe has been stored', () => {
    expect(emailHealthUnprobed({})).toBe(true);
    expect(emailHealthUnprobed({ dns_applied: false, ptr_ok: false, port25_open: null })).toBe(
      true,
    );
  });

  it('is false after any live probe field is set', () => {
    expect(emailHealthUnprobed({ dns_applied: true })).toBe(false);
    expect(emailHealthUnprobed({ ptr_ok: true })).toBe(false);
    expect(emailHealthUnprobed({ port25_open: false })).toBe(false);
    expect(emailHealthUnprobed({ port25_open: true })).toBe(false);
  });
});
