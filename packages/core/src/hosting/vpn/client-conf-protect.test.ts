import { describe, expect, it } from 'vitest';
import {
  extractWgEndpointHost,
  injectWgClientHostProtection,
  isFullTunnelAllowedIps,
} from './client-conf-protect.js';

const FULL = `[Interface]
PrivateKey = abc
Address = 10.6.0.2/32
DNS = 10.6.0.1

[Peer]
PublicKey = xyz
AllowedIPs = 0.0.0.0/0
Endpoint = yanfuhouse.myddns.me:51820
`;

const SPLIT = `[Interface]
PrivateKey = abc
Address = 10.6.0.2/32

[Peer]
PublicKey = xyz
AllowedIPs = 10.6.0.0/24, 192.168.1.0/24
Endpoint = 1.2.3.4:51820
`;

describe('client-conf-protect', () => {
  it('detects full tunnel', () => {
    expect(isFullTunnelAllowedIps(FULL)).toBe(true);
    expect(isFullTunnelAllowedIps(SPLIT)).toBe(false);
  });

  it('extracts endpoint host', () => {
    expect(extractWgEndpointHost(FULL)).toBe('yanfuhouse.myddns.me');
  });

  it('injects protect hooks for full tunnel and comments DNS', () => {
    const r = injectWgClientHostProtection(FULL);
    expect(r.fullTunnel).toBe(true);
    expect(r.modified).toBe(true);
    expect(r.conf).toContain('vpn-client-protect.sh up');
    expect(r.conf).toContain('YSK-CLIENT-HOST-PROTECT-BEGIN');
    expect(r.conf).toMatch(/#.*DNS/i);
    // idempotent
    const r2 = injectWgClientHostProtection(r.conf);
    expect(r2.conf.match(/YSK-CLIENT-HOST-PROTECT-BEGIN/g)?.length).toBe(1);
  });

  it('leaves split tunnel unchanged', () => {
    const r = injectWgClientHostProtection(SPLIT);
    expect(r.modified).toBe(false);
    expect(r.conf).not.toContain('vpn-client-protect');
  });
});
