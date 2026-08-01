import { describe, expect, it } from 'vitest';
import {
  extractIpFromLogLine,
  extractIpsFromText,
  ipFamily,
  ipInCidr,
  ipMatchesList,
  isPrivateOrLocalIp,
  isValidCidr,
  isValidIp,
  isValidIpOrCidr,
  normalizeIp,
  normalizeIpOrCidr,
  reverseDnsblName,
} from './ip.js';

describe('net/ip dual-stack', () => {
  it('validates ipv4 and ipv6', () => {
    expect(isValidIp('203.0.113.10')).toBe(true);
    expect(isValidIp('127.0.0.1')).toBe(true);
    expect(isValidIp('::1')).toBe(true);
    expect(isValidIp('2001:db8::1')).toBe(true);
    expect(isValidIp('[2001:db8::1]')).toBe(true);
    expect(isValidIp('not-an-ip')).toBe(false);
    expect(isValidIp('2001:db8::1%eth0')).toBe(false);
    expect(isValidIp('999.1.1.1')).toBe(false);
    expect(ipFamily('::1')).toBe(6);
    expect(ipFamily('1.2.3.4')).toBe(4);
  });

  it('normalizes and unmaps v4-mapped', () => {
    expect(normalizeIp('  2001:DB8::1  ')).toBe('2001:db8::1');
    expect(normalizeIp('::ffff:203.0.113.1')).toBe('203.0.113.1');
    expect(normalizeIp('[::1]')).toBe('::1');
    expect(normalizeIp('fe80::1%wlan0')).toBeNull();
  });

  it('validates cidr both families', () => {
    expect(isValidCidr('10.0.0.0/8')).toBe(true);
    expect(isValidCidr('2001:db8::/32')).toBe(true);
    expect(isValidCidr('2001:db8::/129')).toBe(false);
    expect(isValidCidr('10.0.0.0/33')).toBe(false);
    expect(isValidIpOrCidr('203.0.113.1')).toBe(true);
    expect(normalizeIpOrCidr('2001:DB8::/32')).toBe('2001:db8::/32');
  });

  it('ipInCidr ipv4 and ipv6', () => {
    expect(ipInCidr('10.0.0.5', '10.0.0.0/8')).toBe(true);
    expect(ipInCidr('11.0.0.5', '10.0.0.0/8')).toBe(false);
    expect(ipInCidr('2001:db8::abcd', '2001:db8::/32')).toBe(true);
    expect(ipInCidr('2001:db9::1', '2001:db8::/32')).toBe(false);
    expect(ipInCidr('2001:db8::1', '2001:db8::1/128')).toBe(true);
  });

  it('ipMatchesList exact + cidr', () => {
    expect(ipMatchesList('10.0.0.5', ['10.0.0.0/8'])).toBe(true);
    expect(ipMatchesList('203.0.113.10', ['127.0.0.1'])).toBe(false);
    expect(ipMatchesList('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(ipMatchesList('2001:db8::1', ['2001:DB8::1'])).toBe(true);
    expect(ipMatchesList('::1', ['127.0.0.1', '::1'])).toBe(true);
  });

  it('isPrivateOrLocalIp covers ULA and link-local', () => {
    expect(isPrivateOrLocalIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIp('10.1.2.3')).toBe(true);
    expect(isPrivateOrLocalIp('192.168.0.1')).toBe(true);
    expect(isPrivateOrLocalIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrLocalIp('203.0.113.1')).toBe(false);
    expect(isPrivateOrLocalIp('::1')).toBe(true);
    expect(isPrivateOrLocalIp('::')).toBe(true);
    expect(isPrivateOrLocalIp('fe80::1')).toBe(true);
    expect(isPrivateOrLocalIp('fd12:3456:789a::1')).toBe(true);
    expect(isPrivateOrLocalIp('2001:db8::1')).toBe(false);
  });

  it('extracts ipv4 and ipv6 from access log lines', () => {
    const v4 =
      '203.0.113.9 - - [01/Jan/2026:00:00:00 +0000] "GET /wp-login.php HTTP/1.1" 404 0';
    expect(extractIpFromLogLine(v4)).toBe('203.0.113.9');
    expect(extractIpsFromText(v4)).toContain('203.0.113.9');

    const v6 =
      '2001:db8::9 - - [01/Jan/2026:00:00:00 +0000] "GET / HTTP/1.1" 200 12';
    expect(extractIpFromLogLine(v6)).toBe('2001:db8::9');

    expect(extractIpFromLogLine('local 127.0.0.1 only')).toBeNull();
  });

  it('reverseDnsblName v4 and v6 nibble', () => {
    expect(reverseDnsblName('1.2.3.4')).toBe('4.3.2.1');
    const rev = reverseDnsblName('2001:db8::1');
    expect(rev).toBeTruthy();
    expect(rev!.startsWith('1.0.0.0.')).toBe(true);
    expect(rev!.endsWith('.8.b.d.0.1.0.0.2')).toBe(true);
    expect(rev!.split('.').length).toBe(32);
  });

  it('edge normalize/cidr/inCidr/private/extract/dnsbl branches', () => {
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp('[]')).toBeNull();
    expect(normalizeIp('[%eth0]')).toBeNull();
    expect(normalizeIp('notip')).toBeNull();
    expect(ipFamily('')).toBe(0);
    expect(isValidCidr('203.0.113.1')).toBe(false); // no slash
    expect(normalizeIpOrCidr('10.0.0.0/x')).toBeNull();
    expect(normalizeIpOrCidr('10.0.0.0/-1')).toBeNull();
    expect(normalizeIpOrCidr('10.0.0.0/0')).toBe('10.0.0.0/0');
    expect(normalizeIpOrCidr('10.0.0.0/32')).toBe('10.0.0.0/32');
    expect(normalizeIpOrCidr('2001:db8::/0')).toBe('2001:db8::/0');
    expect(normalizeIpOrCidr('2001:db8::/128')).toBe('2001:db8::/128');
    expect(normalizeIpOrCidr('2001:db8::/abc')).toBeNull();
    expect(normalizeIpOrCidr('not/24')).toBeNull();

    expect(ipInCidr('bad', '10.0.0.0/8')).toBe(false);
    expect(ipInCidr('10.0.0.1', 'no-cidr')).toBe(false);
    expect(ipInCidr('10.0.0.1', '2001:db8::/32')).toBe(false);
    expect(ipInCidr('10.1.2.3', '0.0.0.0/0')).toBe(true);
    expect(ipInCidr('10.0.0.1', '10.0.0.1/32')).toBe(true);
    expect(ipInCidr('2001:db8::1', '::/0')).toBe(true);
    // full expanded v6 (no ::) for groups path
    expect(
      ipInCidr('2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::/32'),
    ).toBe(true);
    // invalid compressed forms fall back
    expect(ipInCidr('2001:db8::1::2', '2001:db8::/32')).toBe(false);

    expect(ipMatchesList('bad', ['10.0.0.0/8'])).toBe(false);
    expect(ipMatchesList('10.0.0.1', ['', 'not-a-rule', '10.0.0.0/8'])).toBe(true);
    expect(ipMatchesList('10.0.0.1', ['10.0.0.2'])).toBe(false);

    expect(isPrivateOrLocalIp('bad')).toBe(false);
    expect(isPrivateOrLocalIp('0.0.0.0')).toBe(true);
    expect(isPrivateOrLocalIp('127.5.5.5')).toBe(true);
    expect(isPrivateOrLocalIp('169.254.1.1')).toBe(true);
    expect(isPrivateOrLocalIp('172.15.0.1')).toBe(false);
    expect(isPrivateOrLocalIp('172.31.0.1')).toBe(true);
    expect(isPrivateOrLocalIp('172.32.0.1')).toBe(false);
    expect(isPrivateOrLocalIp('fe90::1')).toBe(true);
    expect(isPrivateOrLocalIp('fea0::1')).toBe(true);
    expect(isPrivateOrLocalIp('feb0::1')).toBe(true);
    expect(isPrivateOrLocalIp('fc00::1')).toBe(true);

    // extract: leading, skip 0.x, bracketed, v6 in middle
    expect(extractIpsFromText('0.0.0.1 leading')).not.toContain('0.0.0.1');
    expect(extractIpsFromText('[2001:db8::5] hello')).toContain('2001:db8::5');
    expect(extractIpsFromText('x 2001:db8::9 y')).toContain('2001:db8::9');
    expect(extractIpFromLogLine('only 10.0.0.1 private')).toBeNull();
    expect(extractIpFromLogLine('no ips here')).toBeNull();

    expect(reverseDnsblName('bad')).toBeNull();
    expect(reverseDnsblName('203.0.113.1')).toBe('1.113.0.203');
    // expanded ipv6
    const full = reverseDnsblName('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(full?.split('.').length).toBe(32);
  });
});
