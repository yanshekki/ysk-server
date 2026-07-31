import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  ensureEncryptedTotpSecret,
  isEncryptedTotpSecret,
} from './totp-crypto.js';

describe('totp-crypto', () => {
  let dataDir: string;
  const prevKey = process.env.YSK_SECRETS_KEY;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ysk-totp-crypto-'));
    delete process.env.YSK_SECRETS_KEY;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.YSK_SECRETS_KEY;
    else process.env.YSK_SECRETS_KEY = prevKey;
  });

  it('detects encrypted prefix', () => {
    expect(isEncryptedTotpSecret('yskenc:v1:abc')).toBe(true);
    expect(isEncryptedTotpSecret('JBSWY3DPEHPK3PXP')).toBe(false);
    expect(isEncryptedTotpSecret('')).toBe(false);
  });

  it('roundtrips encrypt/decrypt bound to userId AAD', () => {
    const plain = 'JBSWY3DPEHPK3PXP';
    const enc = encryptTotpSecret(dataDir, 'user-1', plain);
    expect(enc.startsWith('yskenc:v1:')).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptTotpSecret(dataDir, 'user-1', enc)).toBe(plain);
    expect(() => decryptTotpSecret(dataDir, 'user-other', enc)).toThrow();
  });

  it('returns legacy plaintext unchanged when not encrypted', () => {
    const plain = 'LEGACYBASE32SECRET';
    expect(decryptTotpSecret(dataDir, 'u1', plain)).toBe(plain);
  });

  it('ensureEncrypted migrates plaintext once and leaves encrypted alone', () => {
    const plain = 'MIGRATESECRET01';
    const first = ensureEncryptedTotpSecret(dataDir, 'u-mig', plain);
    expect(first.secret).toBe(plain);
    expect(first.migrated).toBeTruthy();
    expect(first.migrated!.startsWith('yskenc:v1:')).toBe(true);

    const second = ensureEncryptedTotpSecret(dataDir, 'u-mig', first.migrated!);
    expect(second.secret).toBe(plain);
    expect(second.migrated).toBeNull();
  });

  it('uses stable master key across encrypt calls in same dataDir', () => {
    const a = encryptTotpSecret(dataDir, 'u', 'AAAA');
    const b = encryptTotpSecret(dataDir, 'u', 'AAAA');
    // different IV → different ciphertext, both decrypt
    expect(a).not.toBe(b);
    expect(decryptTotpSecret(dataDir, 'u', a)).toBe('AAAA');
    expect(decryptTotpSecret(dataDir, 'u', b)).toBe('AAAA');
  });
});
