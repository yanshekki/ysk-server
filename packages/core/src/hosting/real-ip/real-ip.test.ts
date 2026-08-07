import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyRealIpArtifacts,
  loadRealIpConfig,
  normalizeCidrList,
  patchRealIpConfig,
  renderApacheRemoteIpConf,
  renderNginxRealIpBlock,
  resolveRealIpProvider,
  saveRealIpConfig,
} from './index.js';

describe('real-ip', () => {
  it('normalizeCidrList rejects 0.0.0.0/0 and junk', () => {
    expect(normalizeCidrList(['173.245.48.0/20', '0.0.0.0/0', 'not-an-ip', '  '])).toEqual([
      '173.245.48.0/20',
    ]);
  });

  it('resolveRealIpProvider respects legacy cloudflareRealIp and host default', () => {
    expect(resolveRealIpProvider({ cloudflareRealIp: true })).toBe('cloudflare');
    expect(resolveRealIpProvider({ cloudflareRealIp: false })).toBe('none');
    expect(
      resolveRealIpProvider({
        host: {
          defaultProvider: 'fastly',
          trustMode: 'single_provider',
          enabledProviders: ['fastly'],
          customCidrs: [],
        },
      }),
    ).toBe('fastly');
    expect(resolveRealIpProvider({ provider: 'bunny' })).toBe('bunny');
    expect(resolveRealIpProvider({ provider: 'none' })).toBe('none');
    // Project override wins over host default
    expect(
      resolveRealIpProvider({
        provider: 'cloudfront',
        host: {
          defaultProvider: 'cloudflare',
          trustMode: 'single_provider',
          enabledProviders: ['cloudflare'],
          customCidrs: [],
        },
        cloudflareRealIp: true,
      }),
    ).toBe('cloudfront');
  });

  it('renderNginxRealIpBlock cloudflare has header and CIDRs', () => {
    const block = renderNginxRealIpBlock({ provider: 'cloudflare' });
    expect(block).toContain('real_ip_header CF-Connecting-IP');
    expect(block).toContain('set_real_ip_from 173.245.48.0/20');
    expect(block).toContain('real_ip_recursive on');
    expect(renderNginxRealIpBlock({ provider: 'none' })).toBe('');
  });

  it('renderNginxRealIpBlock fastly uses Fastly-Client-IP', () => {
    const block = renderNginxRealIpBlock({ provider: 'fastly' });
    expect(block).toContain('real_ip_header Fastly-Client-IP');
    expect(block).toContain('set_real_ip_from');
  });

  it('xff_merged mode uses X-Forwarded-For and unions CIDRs', () => {
    const block = renderNginxRealIpBlock({
      provider: 'cloudflare',
      host: {
        defaultProvider: 'cloudflare',
        trustMode: 'xff_merged',
        enabledProviders: ['cloudflare', 'fastly'],
        customCidrs: ['10.0.0.0/8'],
      },
    });
    expect(block).toContain('real_ip_header X-Forwarded-For');
    expect(block).toContain('10.0.0.0/8');
  });

  it('custom without CIDRs yields empty (refuse trust-all)', () => {
    expect(
      renderNginxRealIpBlock({
        provider: 'custom',
        host: {
          defaultProvider: 'custom',
          trustMode: 'single_provider',
          enabledProviders: [],
          customCidrs: [],
        },
      }),
    ).toBe('');
  });

  it('renderApacheRemoteIpConf trusts loopback', () => {
    const c = renderApacheRemoteIpConf();
    expect(c).toContain('RemoteIPHeader X-Forwarded-For');
    expect(c).toContain('RemoteIPInternalProxy 127.0.0.1');
  });

  it('load/save/patch config under dataDir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rip-'));
    try {
      expect(loadRealIpConfig(dir).defaultProvider).toBe('none');
      saveRealIpConfig(dir, {
        defaultProvider: 'cloudflare',
        trustMode: 'single_provider',
        enabledProviders: ['cloudflare'],
        customCidrs: ['203.0.113.0/24'],
      });
      expect(loadRealIpConfig(dir).defaultProvider).toBe('cloudflare');
      const p = patchRealIpConfig(dir, { defaultProvider: 'fastly' });
      expect(p.defaultProvider).toBe('fastly');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applyRealIpArtifacts writes snippets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rip-a-'));
    try {
      const r = await applyRealIpArtifacts({ dataDir: dir });
      expect(r.ok).toBe(true);
      expect(existsSync(join(dir, 'nginx', 'real-ip', 'cloudflare.conf'))).toBe(true);
      expect(existsSync(join(dir, 'apache', 'conf-available', 'ysk-remoteip.conf'))).toBe(true);
      const cf = readFileSync(join(dir, 'nginx', 'real-ip', 'cloudflare.conf'), 'utf8');
      expect(cf).toContain('CF-Connecting-IP');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
