import { describe, expect, it } from 'vitest';
import { isValidSshPublicKey } from './ssh-key-format';

describe('isValidSshPublicKey', () => {
  it('accepts a normal ed25519 line', () => {
    expect(
      isValidSshPublicKey(
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA user@host',
      ),
    ).toBe(true);
  });

  it('rejects junk', () => {
    expect(isValidSshPublicKey('not-a-key 12345')).toBe(false);
    expect(isValidSshPublicKey('ssh-ed25519')).toBe(false);
    expect(isValidSshPublicKey('')).toBe(false);
  });
});
