import { describe, expect, it } from 'vitest';
import {
  assessPassword,
  isBootstrapDefaultPassword,
  MIN_PASSWORD_LENGTH,
} from './password-policy.js';

describe('password-policy', () => {
  it('rejects bootstrap default', () => {
    expect(isBootstrapDefaultPassword('admin')).toBe(true);
    expect(isBootstrapDefaultPassword('Admin')).toBe(true);
    expect(isBootstrapDefaultPassword('s3cure-Enough!')).toBe(false);
  });

  it('rejects short and known weak', () => {
    expect(assessPassword('short').ok).toBe(false);
    expect(assessPassword('admin').ok).toBe(false);
    expect(assessPassword('password').ok).toBe(false);
    expect(assessPassword('12345678').ok).toBe(false);
  });

  it('accepts reasonably strong', () => {
    const r = assessPassword('Tr0ub4dor&3-long');
    expect(r.ok).toBe(true);
    expect(r.tooShort).toBe(false);
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});
