import { describe, expect, it } from 'vitest';
import {
  optionalBoolean,
  optionalNumber,
  requireEnum,
  requireString,
} from './validate.js';
import { YskError } from 'ysk-server-shared';

describe('http validate helpers', () => {
  it('requireString trims and enforces min', () => {
    expect(requireString({ name: '  ab  ' }, 'name', { min: 2 })).toBe('ab');
    expect(() => requireString({ name: '' }, 'name')).toThrow(YskError);
    expect(() => requireString({}, 'name')).toThrow(YskError);
  });

  it('requireEnum accepts allowlist', () => {
    expect(requireEnum({ r: 'admin' }, 'r', ['admin', 'viewer'] as const)).toBe('admin');
    expect(() => requireEnum({ r: 'x' }, 'r', ['admin'] as const)).toThrow(YskError);
  });

  it('optionalBoolean / optionalNumber', () => {
    expect(optionalBoolean({ a: true }, 'a')).toBe(true);
    expect(optionalBoolean({}, 'a')).toBeUndefined();
    expect(optionalNumber({ n: 3 }, 'n', { min: 1, max: 5 })).toBe(3);
    expect(() => optionalNumber({ n: 99 }, 'n', { max: 5 })).toThrow(YskError);
  });
});
