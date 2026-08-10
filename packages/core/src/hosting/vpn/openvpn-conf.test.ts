import { describe, expect, it } from 'vitest';
import {
  buildOpenVpnClientOvpn,
  buildOpenVpnServerConf,
  nextOpenVpnClientIp,
  openVpnClientUnitName,
} from './openvpn-conf.js';

describe('openvpn-conf pure helpers', () => {
  it('builds server conf', () => {
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
