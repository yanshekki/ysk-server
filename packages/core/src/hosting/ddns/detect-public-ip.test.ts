import { describe, expect, it } from 'vitest';
import { isCgnatIpv4, isPublicIpv4, isPublicIpv6, detectPublicIpv4 } from './detect-public-ip.js';

describe('detect-public-ip', () => {
  it('rejects RFC1918, loopback, link-local, and CGNAT', () => {
    expect(isPublicIpv4('10.0.0.1')).toBe(false);
    expect(isPublicIpv4('192.168.1.1')).toBe(false);
    expect(isPublicIpv4('172.16.0.1')).toBe(false);
    expect(isPublicIpv4('127.0.0.1')).toBe(false);
    expect(isPublicIpv4('169.254.1.1')).toBe(false);
    expect(isCgnatIpv4('100.64.0.1')).toBe(true);
    expect(isPublicIpv4('100.64.0.1')).toBe(false);
    expect(isPublicIpv4('203.0.113.10')).toBe(true);
  });

  it('rejects unique-local and link-local IPv6', () => {
    expect(isPublicIpv6('::1')).toBe(false);
    expect(isPublicIpv6('fe80::1')).toBe(false);
    expect(isPublicIpv6('fd12::1')).toBe(false);
    expect(isPublicIpv6('2001:db8::1')).toBe(true);
  });

  it('fail-closes when probes return private or empty', async () => {
    const r = await detectPublicIpv4(async () => '10.1.2.3');
    expect(r.ip).toBeNull();
    expect(r.error).toBe('notPublicIpv4');
    const empty = await detectPublicIpv4(async () => '');
    expect(empty.ip).toBeNull();
    expect(empty.error).toBe('probeFailed');
  });

  it('accepts the first public IPv4 from the probe list', async () => {
    let n = 0;
    const r = await detectPublicIpv4(async () => {
      n += 1;
      return n === 1 ? '192.168.0.1' : '203.0.113.9';
    });
    expect(r.ip).toBe('203.0.113.9');
    expect(r.error).toBeNull();
  });
});
