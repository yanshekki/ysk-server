import { describe, expect, it } from 'vitest';
import {
  applyOvpnRemote,
  formatVpnEndpoint,
  isValidEndpointHost,
  parseVpnEndpoint,
} from './endpoint.js';

describe('vpn endpoint', () => {
  it('accepts host:port', () => {
    expect(parseVpnEndpoint('203.0.113.10:1194', 1194)).toEqual({
      host: '203.0.113.10',
      port: 1194,
      ok: true,
    });
  });

  it('rejects WG-port-as-host typo 51820:1194', () => {
    const p = parseVpnEndpoint('51820:1194', 1194);
    expect(p.ok).toBe(false);
    expect(p.host).toBe('YOUR_PUBLIC_IP');
    expect(p.port).toBe(1194);
  });

  it('rejects bare digits', () => {
    expect(parseVpnEndpoint('51820', 1194).ok).toBe(false);
  });

  it('accepts bare hostname with listen port', () => {
    expect(parseVpnEndpoint('vpn.example.com', 1194)).toEqual({
      host: 'vpn.example.com',
      port: 1194,
      ok: true,
    });
  });

  it('isValidEndpointHost', () => {
    expect(isValidEndpointHost('1.2.3.4')).toBe(true);
    expect(isValidEndpointHost('51820')).toBe(false);
    expect(isValidEndpointHost('')).toBe(false);
  });

  it('formatVpnEndpoint skips digit-only host', () => {
    expect(formatVpnEndpoint('51820', 1194)).toBe('');
    expect(formatVpnEndpoint('1.2.3.4', 1194)).toBe('1.2.3.4:1194');
  });

  it('applyOvpnRemote rewrites bad remote', () => {
    const bad = [
      'client',
      'proto udp',
      'remote 51820 1194',
      'nobind',
      '',
    ].join('\n');
    const fixed = applyOvpnRemote(bad, '203.0.113.10', 1194);
    expect(fixed).toContain('remote 203.0.113.10 1194');
    expect(fixed).not.toContain('remote 51820');
  });
});
