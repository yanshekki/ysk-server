import { describe, expect, it } from 'vitest';
import { assertSafeOutboundUrl, isBlockedSsrfHost } from './ssrf.js';
import { YskError } from 'ysk-server-shared';

describe('ssrf guards', () => {
  it('strict policy blocks RFC1918 and metadata', () => {
    expect(isBlockedSsrfHost('127.0.0.1', 'strict')).toBe(true);
    expect(isBlockedSsrfHost('10.0.0.5', 'strict')).toBe(true);
    expect(isBlockedSsrfHost('192.168.1.1', 'strict')).toBe(true);
    expect(isBlockedSsrfHost('169.254.169.254', 'strict')).toBe(true);
    expect(isBlockedSsrfHost('localhost', 'strict')).toBe(true);
    expect(isBlockedSsrfHost('example.com', 'strict')).toBe(false);
  });

  it('metadata policy allows fleet private, blocks IMDS', () => {
    expect(isBlockedSsrfHost('10.0.0.5', 'metadata')).toBe(false);
    expect(isBlockedSsrfHost('169.254.169.254', 'metadata')).toBe(true);
    expect(isBlockedSsrfHost('127.0.0.1', 'metadata')).toBe(true);
  });

  it('assertSafeOutboundUrl allows public https', () => {
    const u = assertSafeOutboundUrl('https://health.example.com/ok');
    expect(u.hostname).toBe('health.example.com');
  });

  it('blocks IPv4-mapped IMDS and cloud metadata aliases', () => {
    expect(isBlockedSsrfHost('::ffff:169.254.169.254', 'strict')).toBe(true);
    expect(isBlockedSsrfHost('::ffff:a9fe:a9fe', 'strict')).toBe(true);
    expect(isBlockedSsrfHost('::ffff:127.0.0.1', 'metadata')).toBe(true);
    expect(isBlockedSsrfHost('fd00:ec2::254', 'metadata')).toBe(true);
    expect(isBlockedSsrfHost('100.100.100.200', 'metadata')).toBe(true);
    expect(isBlockedSsrfHost('::ffff:10.1.2.3', 'strict')).toBe(true);
  });

  it('assertSafeOutboundUrl rejects metadata and file schemes', () => {
    expect(() => assertSafeOutboundUrl('http://169.254.169.254/latest')).toThrow(YskError);
    expect(() => assertSafeOutboundUrl('file:///etc/passwd')).toThrow(YskError);
    // loopback is allowed under VITEST for local probe servers; still blocked by policy flag
    expect(isBlockedSsrfHost('127.0.0.1', 'metadata')).toBe(true);
    // CDN policy allows 10.x
    expect(() =>
      assertSafeOutboundUrl('http://10.0.0.9/health', { policy: 'metadata' }),
    ).not.toThrow();
  });
});
