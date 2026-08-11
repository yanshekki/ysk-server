import { describe, expect, it } from 'vitest';
import {
  buildOpenVpnClientOvpn,
  buildOpenVpnServerConf,
  nextOpenVpnClientIp,
  openVpnClientUnitName,
} from './openvpn-conf.js';

describe('openvpn-conf pure helpers', () => {
  it('builds server conf (full internet default)', () => {
    const c = buildOpenVpnServerConf({
      port: 1194,
      proto: 'udp',
      caPath: '/ca.crt',
      certPath: '/s.crt',
      keyPath: '/s.key',
      dhPath: '/dh.pem',
      taPath: '/ta.key',
      ccdDir: '/ccd',
    });
    expect(c).toContain('port 1194');
    expect(c).toContain('proto udp');
    expect(c).toContain('server 10.8.0.0');
    expect(c).toContain('status-version 2');
    expect(c).toContain('/run/openvpn-server/ysk-status.log');
    expect(c).toContain('redirect-gateway');
    expect(c).toContain('dhcp-option DNS');
  });

  it('builds server conf for LAN-only (no redirect-gateway)', () => {
    const c = buildOpenVpnServerConf({
      port: 1194,
      proto: 'udp',
      caPath: '/ca.crt',
      certPath: '/s.crt',
      keyPath: '/s.key',
      dhPath: '/dh.pem',
      taPath: '/ta.key',
      ccdDir: '/ccd',
      accessMode: 'lan',
      lanCidrs: ['192.168.0.0/16'],
    });
    expect(c).not.toContain('redirect-gateway');
    expect(c).toContain('push "route 192.168.0.0');
    expect(c).not.toContain('dhcp-option DNS');
  });

  it('builds inline ovpn client', () => {
    const c = buildOpenVpnClientOvpn({
      remote: 'vpn.example.com',
      port: 1194,
      proto: 'udp',
      caCrt: 'CA',
      clientCrt: 'CRT',
      clientKey: 'KEY',
      taKey: 'TA',
    });
    expect(c).toContain('remote vpn.example.com 1194');
    expect(c).toContain('<ca>');
    expect(c).toContain('CA');
  });

  it('allocates client IPs', () => {
    expect(nextOpenVpnClientIp([])).toBe('10.8.0.2');
    expect(nextOpenVpnClientIp(['10.8.0.2'])).toBe('10.8.0.3');
  });

  it('unit name', () => {
    expect(openVpnClientUnitName('abc123')).toMatch(/^ysk-ovpn-c-/);
  });
});
