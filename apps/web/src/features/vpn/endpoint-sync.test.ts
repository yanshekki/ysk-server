import { describe, expect, it } from 'vitest';
import {
  buildEndpoint,
  confDownloadName,
  detectClientEngine,
  defaultPortForEngine,
  hostFromEndpoint,
  syncEndpointPort,
} from './endpoint-sync';

describe('vpn endpoint-sync', () => {
  it('rewrites port keeping host', () => {
    expect(syncEndpointPort('hermes.ysk.hk:51820', 51821, 'x')).toBe(
      'hermes.ysk.hk:51821',
    );
  });

  it('uses fallback when empty', () => {
    expect(syncEndpointPort('', 51820, 'hermes.ysk.hk')).toBe(
      'hermes.ysk.hk:51820',
    );
  });

  it('parses host without port', () => {
    expect(hostFromEndpoint('vpn.example.com', '')).toBe('vpn.example.com');
    expect(buildEndpoint('vpn.example.com', 1194)).toBe('vpn.example.com:1194');
  });

  it('default ports', () => {
    expect(defaultPortForEngine('wireguard')).toBe(51820);
    expect(defaultPortForEngine('openvpn', 'udp')).toBe(1194);
    expect(defaultPortForEngine('openvpn', 'tcp')).toBe(443);
    expect(defaultPortForEngine('outline')).toBe(8388);
  });

  it('download names', () => {
    expect(confDownloadName('wireguard', 'phone')).toBe('phone.conf');
    expect(confDownloadName('openvpn', 'phone')).toBe('phone.ovpn');
  });

  it('detects conf engine', () => {
    expect(detectClientEngine('[Interface]\nPrivateKey = x')).toBe('wireguard');
    expect(detectClientEngine('client\nremote 1.2.3.4 1194')).toBe('openvpn');
  });
});
