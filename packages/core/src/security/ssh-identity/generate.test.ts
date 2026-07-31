import { describe, expect, it } from 'vitest';
import {
  fingerprintFromPublicKey,
  generateSshKeyPair,
  parseImportedPrivateKey,
  publicKeyFromPrivate,
} from './generate.js';

describe('ssh-identity generate unit', () => {
  it('generates ed25519 with matching fingerprint and public derivation', () => {
    const pair = generateSshKeyPair({ algorithm: 'ed25519', comment: 'unit@ysk' });
    expect(pair.algorithm).toBe('ed25519');
    expect(pair.publicKey.startsWith('ssh-ed25519 ')).toBe(true);
    expect(pair.publicKey).toContain('unit@ysk');
    expect(pair.privateKey).toMatch(/OPENSSH PRIVATE KEY|PRIVATE KEY/);
    expect(pair.fingerprintSha256.startsWith('SHA256:')).toBe(true);
    expect(fingerprintFromPublicKey(pair.publicKey)).toBe(pair.fingerprintSha256);
    expect(publicKeyFromPrivate(pair.privateKey).split(' ').slice(0, 2).join(' ')).toBe(
      pair.publicKey.split(' ').slice(0, 2).join(' '),
    );
  });

  it('generates rsa-4096 when requested', () => {
    const pair = generateSshKeyPair({ algorithm: 'rsa-4096', comment: 'rsa@ysk' });
    expect(pair.algorithm).toBe('rsa-4096');
    expect(pair.publicKey.startsWith('ssh-rsa ')).toBe(true);
    expect(pair.fingerprintSha256.startsWith('SHA256:')).toBe(true);
  }, 60_000);

  it('parseImportedPrivateKey rejects non-key material', () => {
    expect(() => parseImportedPrivateKey('not a key')).toThrow(/PRIVATE KEY/);
  });

  it('parseImportedPrivateKey rehydrates generated material', () => {
    const pair = generateSshKeyPair({ algorithm: 'ed25519' });
    // without trailing newline still works
    const parsed = parseImportedPrivateKey(pair.privateKey.trimEnd());
    expect(parsed.algorithm).toBe('ed25519');
    expect(parsed.fingerprintSha256).toBe(pair.fingerprintSha256);
    expect(parsed.publicKey.split(' ').slice(0, 2)).toEqual(
      pair.publicKey.split(' ').slice(0, 2),
    );
  });

  it('fingerprintFromPublicKey throws on garbage', () => {
    expect(() => fingerprintFromPublicKey('ssh-ed25519 AAAA not-valid')).toThrow();
  });
});
