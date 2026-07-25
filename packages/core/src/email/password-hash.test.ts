import { describe, expect, it } from 'vitest';
import { hashMailboxPassword, hashMailboxPasswordSync } from './password-hash.js';

describe('password-hash', () => {
  it('sync scrypt produces scrypt$ form', () => {
    const r = hashMailboxPasswordSync('longpassword99');
    expect(r.scheme).toBe('YSK-SCRYPT');
    expect(r.hash).toMatch(/^scrypt\$[a-f0-9]+\$[a-f0-9]+$/);
  });

  it('async prefers SHA512-CRYPT when openssl works', async () => {
    const r = await hashMailboxPassword('longpassword99');
    expect(['SHA512-CRYPT', 'YSK-SCRYPT']).toContain(r.scheme);
    if (r.scheme === 'SHA512-CRYPT') {
      expect(r.hash).toMatch(/^\{SHA512-CRYPT\}\$6\$/);
    } else {
      expect(r.hash).toMatch(/^scrypt\$/);
    }
  });
});
