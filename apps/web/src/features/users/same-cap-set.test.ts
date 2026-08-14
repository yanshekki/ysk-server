import { describe, expect, it } from 'vitest';
import { sameCapSet } from './RolePermissionsPanel';

describe('sameCapSet', () => {
  it('ignores order', () => {
    expect(sameCapSet(['a', 'b'] as never, ['b', 'a'] as never)).toBe(true);
  });
  it('detects missing', () => {
    expect(sameCapSet(['a'] as never, ['a', 'b'] as never)).toBe(false);
  });
});
