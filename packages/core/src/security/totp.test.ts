import { describe, expect, it } from 'vitest';
import {
  buildOtpAuthUrl,
  generateTotpCode,
  generateTotpSecret,
  verifyTotp,
} from './totp.js';

describe('totp', () => {
  it('generates secret and verifies current code', () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThan(10);
    const code = generateTotpCode(secret);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, '000000')).toBe(false);
  });

  it('builds otpauth URL', () => {
    const url = buildOtpAuthUrl({ secret: 'JBSWY3DPEHPK3PXP', username: 'admin' });
    expect(url).toContain('otpauth://totp/');
    expect(url).toContain('admin');
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
  });
});
