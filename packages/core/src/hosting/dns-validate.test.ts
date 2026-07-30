import { describe, expect, it } from 'vitest';
import {
  hasDnsErrors,
  validateDnsRecord,
  validateDnsRecordSet,
} from './dns-validate.js';

describe('dns-validate', () => {
  it('accepts valid A record', () => {
    const issues = validateDnsRecord({
      type: 'A',
      name: '@',
      value: '1.2.3.4',
      ttl: 300,
    });
    expect(hasDnsErrors(issues)).toBe(false);
  });

  it('rejects bad A and apex CNAME warn', () => {
    expect(
      hasDnsErrors(
        validateDnsRecord({ type: 'A', name: 'www', value: 'not-ip' }),
      ),
    ).toBe(true);
    const cname = validateDnsRecord({
      type: 'CNAME',
      name: '@',
      value: 'cdn.example.com.',
    });
    expect(cname.some((i) => i.code === 'apex_cname')).toBe(true);
  });

  it('detects CNAME conflict with A', () => {
    const issues = validateDnsRecordSet([
      { type: 'A', name: 'www', value: '1.2.3.4' },
      { type: 'CNAME', name: 'www', value: 'other.example.com.' },
    ]);
    expect(issues.some((i) => i.code === 'cname_conflict')).toBe(true);
    expect(hasDnsErrors(issues)).toBe(true);
  });
});
