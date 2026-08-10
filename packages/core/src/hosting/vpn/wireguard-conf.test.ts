import { describe, expect, it } from 'vitest';
import {
  buildClientConf,
  buildServerConf,
  clientIfaceName,
  nextClientAddress,
  sanitizePeerName,
} from './wireguard-conf.js';

describe('wireguard-conf pure helpers', () => {
  it('builds server conf with peers', () => {
    const conf = buildServerConf({
      privateKey: 'SERVER_PRIV',
      address: '10.66.66.1/24',
      listenPort: 51820,
      peers: [{ publicKey: 'PEER_PUB', allowedIps: '10.66.66.2/32', name: 'phone' }],
    });
    expect(conf).toContain('ListenPort = 51820');
    expect(conf).toContain('PEER_PUB');
    expect(conf).toContain('phone');
  });

  it('builds client conf with endpoint', () => {
    const conf = buildClientConf({
      privateKey: 'CLI_PRIV',
      address: '10.66.66.2/32',
      serverPublicKey: 'SRV_PUB',
      endpoint: 'vpn.example.com:51820',
    });
    expect(conf).toContain('Endpoint = vpn.example.com:51820');
    expect(conf).toContain('DNS = 1.1.1.1');
  });

  it('allocates next client address', () => {
    expect(nextClientAddress([])).toBe('10.66.66.2/32');
    expect(nextClientAddress(['10.66.66.2/32', '10.66.66.3/32'])).toBe(
      '10.66.66.4/32',
    );
  });

  it('sanitizes names and iface', () => {
    expect(sanitizePeerName('My Phone!!')).toBe('my-phone');
    expect(clientIfaceName('abcd1234-xxxx')).toMatch(/^wg-c-/);
  });
});
