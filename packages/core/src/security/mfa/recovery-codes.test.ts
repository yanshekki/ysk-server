import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  consumeRecoveryCode,
} from './recovery-codes.js';

describe('recovery-codes', () => {
  it('generates unique formatted codes', () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    }
  });

  it('hash is stable and case/space insensitive', () => {
    const a = hashRecoveryCode('AbCd-Ef01-2345-6789');
    const b = hashRecoveryCode('  abcd-ef01-2345-6789  ');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('consume removes matching hash only once', () => {
    const codes = generateRecoveryCodes(3);
    const hashes = codes.map(hashRecoveryCode);
    const first = consumeRecoveryCode(hashes, codes[1]!);
    expect(first.ok).toBe(true);
    expect(first.remaining).toHaveLength(2);
    const again = consumeRecoveryCode(first.remaining, codes[1]!);
    expect(again.ok).toBe(false);
    expect(again.remaining).toHaveLength(2);
  });

  it('rejects unknown code without mutating list length incorrectly', () => {
    const hashes = [hashRecoveryCode('aaaa-bbbb-cccc-dddd')];
    const r = consumeRecoveryCode(hashes, 'ffff-eeee-dddd-cccc');
    expect(r.ok).toBe(false);
    expect(r.remaining).toEqual(hashes);
  });

  it('skips corrupt hash entries safely', () => {
    const good = hashRecoveryCode('1111-2222-3333-4444');
    const r = consumeRecoveryCode(['not-hex!!!', good], '1111-2222-3333-4444');
    expect(r.ok).toBe(true);
    expect(r.remaining).toContain('not-hex!!!');
    expect(r.remaining).not.toContain(good);
  });
});
