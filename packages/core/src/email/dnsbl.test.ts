import { describe, expect, it } from 'vitest';
import { checkDnsblZone, checkIpDnsbl, reverseIpv4 } from './dnsbl.js';

describe('dnsbl', () => {
  it('reverses ipv4', () => {
    expect(reverseIpv4('1.2.3.4')).toBe('4.3.2.1');
    expect(reverseIpv4('bad')).toBeNull();
  });

  it('reports listed when resolve returns A', async () => {
    const resolve = async () => ['127.0.0.2'];
    const r = await checkDnsblZone('1.2.3.4', 'zen.spamhaus.org', resolve as never);
    expect(r.listed).toBe(true);
    expect(r.query).toBe('4.3.2.1.zen.spamhaus.org');
  });

  it('reports clean on ENOTFOUND', async () => {
    const resolve = async () => {
      const e = new Error('not found') as Error & { code: string };
      e.code = 'ENOTFOUND';
      throw e;
    };
    const report = await checkIpDnsbl('8.8.8.8', ['zen.spamhaus.org'], resolve as never);
    expect(report.ok).toBe(true);
    expect(report.listedOn).toHaveLength(0);
  });
});
