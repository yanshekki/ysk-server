import { describe, expect, it } from 'vitest';
import { classifyHttpProbeFailure } from './http-probe-error.js';

describe('classifyHttpProbeFailure', () => {
  it('unwraps Node fetch failed cause codes', () => {
    const refused = new Error('fetch failed');
    (refused as Error & { cause: { code: string } }).cause = { code: 'ECONNREFUSED' };
    expect(classifyHttpProbeFailure(refused).code).toBe('refused');

    const dns = new Error('fetch failed');
    (dns as Error & { cause: { code: string } }).cause = { code: 'ENOTFOUND' };
    expect(classifyHttpProbeFailure(dns).code).toBe('dns');

    const timeout = new Error('The operation was aborted');
    timeout.name = 'AbortError';
    expect(classifyHttpProbeFailure(timeout).code).toBe('timeout');

    const tls = new Error('unable to verify the first certificate');
    expect(classifyHttpProbeFailure(tls).code).toBe('tls');
  });
});
