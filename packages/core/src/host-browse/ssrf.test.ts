import { describe, expect, it } from 'vitest';
import { ErrorCodes, YskError } from '@ysk-server/shared';
import {
  assertHostBrowseTarget,
  isHostAllowedForMode,
  parseBrowseUrl,
} from './ssrf.js';

describe('host-browse ssrf', () => {
  it('parseBrowseUrl adds https by default', () => {
    const u = parseBrowseUrl('example.com/path');
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('example.com');
  });

  it('rejects non-http schemes and userinfo', () => {
    expect(() => parseBrowseUrl('file:///etc/passwd')).toThrow(YskError);
    expect(() => parseBrowseUrl('https://user:pass@example.com/')).toThrow(YskError);
  });

  it('internet mode blocks private and metadata', () => {
    expect(isHostAllowedForMode('127.0.0.1', { mode: 'internet' }).ok).toBe(false);
    expect(isHostAllowedForMode('10.0.0.1', { mode: 'internet' }).ok).toBe(false);
    expect(isHostAllowedForMode('192.168.1.1', { mode: 'internet' }).ok).toBe(false);
    expect(isHostAllowedForMode('169.254.169.254', { mode: 'internet' }).ok).toBe(false);
    expect(isHostAllowedForMode('example.com', { mode: 'internet' }).ok).toBe(true);
  });

  it('intranet allows RFC1918 but still blocks metadata', () => {
    expect(isHostAllowedForMode('10.0.0.5', { mode: 'intranet' }).ok).toBe(true);
    expect(isHostAllowedForMode('192.168.0.1', { mode: 'intranet' }).ok).toBe(true);
    expect(isHostAllowedForMode('169.254.169.254', { mode: 'intranet' }).ok).toBe(false);
    expect(isHostAllowedForMode('127.0.0.1', { mode: 'intranet' }).ok).toBe(false);
    expect(
      isHostAllowedForMode('127.0.0.1', { mode: 'intranet', allowLoopback: true }).ok,
    ).toBe(true);
  });

  it('assertHostBrowseTarget rejects metadata in both modes', async () => {
    await expect(
      assertHostBrowseTarget('http://169.254.169.254/latest', { mode: 'internet' }),
    ).rejects.toMatchObject({ code: ErrorCodes.HOST_BROWSE_SSRF });
    await expect(
      assertHostBrowseTarget('http://169.254.169.254/latest', { mode: 'intranet' }),
    ).rejects.toMatchObject({ code: ErrorCodes.HOST_BROWSE_SSRF });
  });

  it('assertHostBrowseTarget allows public https in internet mode', async () => {
    // example.com resolves publicly; if DNS fails in sandbox, skip soft
    try {
      const u = await assertHostBrowseTarget('https://example.com/', { mode: 'internet' });
      expect(u.hostname).toBe('example.com');
    } catch (e) {
      if (e instanceof YskError && e.code === ErrorCodes.HOST_BROWSE_SSRF) {
        const reason = (e.details as { reason?: string })?.reason;
        if (reason === 'dns_failed') return;
      }
      throw e;
    }
  });

  it('blocks unusual ports in internet mode', async () => {
    await expect(
      assertHostBrowseTarget('https://example.com:25/', { mode: 'internet' }),
    ).rejects.toMatchObject({ code: ErrorCodes.HOST_BROWSE_SSRF });
  });

  it('allows common admin ports in intranet mode for private IP', async () => {
    const u = await assertHostBrowseTarget('http://192.168.1.1:8080/', {
      mode: 'intranet',
    });
    expect(u.port).toBe('8080');
  });
});
