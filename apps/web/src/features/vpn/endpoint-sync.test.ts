import { describe, expect, it } from 'vitest';
import {
  buildEndpoint,
  confDownloadName,
  detectClientEngine,
  defaultPortForEngine,
  hostFromEndpoint,
  isVpnPeerName,
  parseListenPortInput,
  previewVpnPeerName,
  syncEndpointPort,
} from './endpoint-sync';

describe('vpn endpoint-sync', () => {
  it('rewrites port keeping host', () => {
    expect(syncEndpointPort('demo.ysk.hk:51820', 51821, 'x')).toBe(
      'demo.ysk.hk:51821',
    );
  });

  it('uses fallback when empty', () => {
    expect(syncEndpointPort('', 51820, 'demo.ysk.hk')).toBe(
      'demo.ysk.hk:51820',
    );
  });

  it('parses host without port', () => {
    expect(hostFromEndpoint('vpn.example.com', '')).toBe('vpn.example.com');
    expect(buildEndpoint('vpn.example.com', 1194)).toBe('vpn.example.com:1194');
  });

  it('rejects digit-only host typos like 51820:1194', () => {
    expect(hostFromEndpoint('51820:1194', '')).toBe('');
    expect(hostFromEndpoint('51820:1194', 'fallback.example')).toBe(
      'fallback.example',
    );
    expect(buildEndpoint('51820', 1194)).toBe('');
    expect(syncEndpointPort('51820:1194', 1194, '1.2.3.4')).toBe('1.2.3.4:1194');
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
    expect(detectClientEngine('not a vpn file')).toBeUndefined();
  });

  it('rejects peer names with space / or !', () => {
    expect(isVpnPeerName('office-laptop')).toBe(true);
    expect(isVpnPeerName('qa vpn/tmp!')).toBe(false);
    expect(isVpnPeerName('qa-vpn-tmp')).toBe(true);
    expect(previewVpnPeerName('qa vpn/tmp!')).toBe('qa-vpn-tmp');
  });

  it('does not clamp out-of-range listen ports', () => {
    expect(parseListenPortInput('51820')).toBe(51820);
    expect(parseListenPortInput('99999')).toBeNull();
    expect(parseListenPortInput('0')).toBeNull();
    expect(parseListenPortInput('65535')).toBe(65535);
    expect(parseListenPortInput('65536')).toBeNull();
  });
});
