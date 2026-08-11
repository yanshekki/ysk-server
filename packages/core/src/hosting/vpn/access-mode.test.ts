import { describe, expect, it } from 'vitest';
import {
  buildVpnNatShell,
  cidrToOvpnRoutePush,
  needsInternetNat,
  normalizeCidrList,
  ovpnAccessPushLines,
  parseAccessMode,
  wgClientAllowedIps,
} from './access-mode.js';

describe('vpn access-mode', () => {
  it('parses access mode aliases', () => {
    expect(parseAccessMode('full')).toBe('full');
    expect(parseAccessMode('lan')).toBe('lan');
    expect(parseAccessMode('local')).toBe('lan');
    expect(parseAccessMode('split')).toBe('lan');
    expect(parseAccessMode('custom')).toBe('custom');
    expect(parseAccessMode('nope')).toBe('full');
    expect(parseAccessMode(undefined)).toBe('full');
  });

  it('normalizes CIDR lists', () => {
    expect(normalizeCidrList(['10.0.0.0/8', 'bad', '10.0.0.0/8', '192.168.1.0/24'])).toEqual([
      '10.0.0.0/8',
      '192.168.1.0/24',
    ]);
    expect(normalizeCidrList(null)).toEqual([]);
  });

  it('converts CIDR to OpenVPN route push', () => {
    expect(cidrToOvpnRoutePush('10.0.0.0/8')).toBe('push "route 10.0.0.0 255.0.0.0"');
    expect(cidrToOvpnRoutePush('192.168.1.0/24')).toBe(
      'push "route 192.168.1.0 255.255.255.0"',
    );
    expect(cidrToOvpnRoutePush('not-cidr')).toBeNull();
  });

  it('needsInternetNat only for full or default-route custom', () => {
    expect(needsInternetNat('full', [])).toBe(true);
    expect(needsInternetNat('lan', [])).toBe(false);
    expect(needsInternetNat('custom', ['10.0.0.0/8'])).toBe(false);
    expect(needsInternetNat('custom', ['0.0.0.0/0'])).toBe(true);
  });

  it('builds WireGuard AllowedIPs per mode', () => {
    expect(wgClientAllowedIps('full')).toBe('0.0.0.0/0, ::/0');
    expect(wgClientAllowedIps('lan')).toContain('10.66.66.0/24');
    expect(wgClientAllowedIps('lan')).toContain('10.0.0.0/8');
    expect(wgClientAllowedIps('custom', { customCidrs: ['203.0.113.0/24'] })).toBe(
      '203.0.113.0/24',
    );
    expect(wgClientAllowedIps('custom', { customCidrs: [] })).toBe('10.66.66.0/24');
  });

  it('builds OpenVPN access push lines', () => {
    const full = ovpnAccessPushLines('full');
    expect(full.some((l) => l.includes('redirect-gateway'))).toBe(true);

    const lan = ovpnAccessPushLines('lan', {
      lanCidrs: ['192.168.0.0/16'],
      vpnNetCidr: '10.8.0.0/24',
    });
    expect(lan.some((l) => l.includes('redirect-gateway'))).toBe(false);
    expect(lan.some((l) => l.includes('10.8.0.0'))).toBe(true);
    expect(lan.some((l) => l.includes('192.168.0.0'))).toBe(true);

    const custom = ovpnAccessPushLines('custom', {
      customCidrs: ['10.1.0.0/16'],
      vpnNetCidr: '10.8.0.0/24',
    });
    expect(custom.some((l) => l.includes('10.1.0.0'))).toBe(true);
  });

  it('buildVpnNatShell includes MASQUERADE when enableNat', () => {
    const full = buildVpnNatShell({
      sourceCidr: '10.8.0.0/24',
      tunnelIfaceHint: 'tun0',
      enableNat: true,
      mark: 'YSK-VPN-OVPN',
    });
    expect(full).toContain('ip_forward');
    expect(full).toContain('MASQUERADE');
    expect(full).toContain('YSK-VPN-OVPN');

    const lan = buildVpnNatShell({
      sourceCidr: '10.8.0.0/24',
      tunnelIfaceHint: 'tun0',
      enableNat: false,
      lanCidrs: ['192.168.0.0/16'],
      mark: 'YSK-VPN-OVPN',
    });
    expect(lan).not.toContain('MASQUERADE');
    expect(lan).toContain('192.168.0.0/16');
    expect(lan).toContain('lan forward only');
  });
});
