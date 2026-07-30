import { describe, expect, it } from 'vitest';
import {
  parseIpAddrJson,
  parseIpRouteJson,
  parseResolvConf,
  parseCidr,
  isValidIfName,
  mergeLinkStats,
} from './network-parse.js';

describe('parseIpAddrJson', () => {
  it('parses interfaces and addrs', () => {
    const raw = JSON.stringify([
      {
        ifindex: 1,
        ifname: 'lo',
        flags: ['LOOPBACK', 'UP'],
        mtu: 65536,
        operstate: 'UNKNOWN',
        address: '00:00:00:00:00:00',
        addr_info: [
          { family: 'inet', local: '127.0.0.1', prefixlen: 8, scope: 'host' },
        ],
      },
      {
        ifindex: 2,
        ifname: 'eth0',
        flags: ['BROADCAST', 'UP'],
        mtu: 1500,
        operstate: 'UP',
        address: 'aa:bb:cc:dd:ee:ff',
        addr_info: [
          {
            family: 'inet',
            local: '192.168.1.10',
            prefixlen: 24,
            scope: 'global',
          },
        ],
      },
    ]);
    const ifaces = parseIpAddrJson(raw);
    expect(ifaces).toHaveLength(2);
    expect(ifaces[0].isLoopback).toBe(true);
    expect(ifaces[1].addrs[0].local).toBe('192.168.1.10');
    expect(ifaces[1].mac).toBe('aa:bb:cc:dd:ee:ff');
  });
});

describe('parseIpRouteJson', () => {
  it('parses default route', () => {
    const raw = JSON.stringify([
      { dst: 'default', gateway: '192.168.1.1', dev: 'eth0', protocol: 'dhcp', metric: 100 },
      { dst: '192.168.1.0/24', dev: 'eth0', protocol: 'kernel', scope: 'link' },
    ]);
    const routes = parseIpRouteJson(raw);
    expect(routes[0].gateway).toBe('192.168.1.1');
    expect(routes[1].dst).toBe('192.168.1.0/24');
  });
});

describe('parseResolvConf', () => {
  it('extracts nameservers', () => {
    const p = parseResolvConf(`
# comment
nameserver 1.1.1.1
nameserver 8.8.8.8
search lan local
`);
    expect(p.nameservers).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(p.search).toContain('lan');
  });
});

describe('parseCidr / isValidIfName', () => {
  it('validates cidr and ifname', () => {
    expect(parseCidr('10.0.0.1/24').ok).toBe(true);
    expect(parseCidr('bad').ok).toBe(false);
    expect(isValidIfName('eth0')).toBe(true);
    expect(isValidIfName('wlo1')).toBe(true);
    expect(isValidIfName('../x')).toBe(false);
  });
});

describe('mergeLinkStats', () => {
  it('attaches stats64', () => {
    const ifaces = parseIpAddrJson(
      JSON.stringify([
        {
          ifindex: 1,
          ifname: 'eth0',
          flags: ['UP'],
          operstate: 'UP',
          addr_info: [],
        },
      ]),
    );
    const link = JSON.stringify([
      {
        ifname: 'eth0',
        stats64: {
          rx: { bytes: 1000, packets: 10 },
          tx: { bytes: 2000, packets: 20 },
        },
      },
    ]);
    const m = mergeLinkStats(ifaces, link);
    expect(m[0].stats?.rxBytes).toBe(1000);
    expect(m[0].stats?.txPackets).toBe(20);
  });
});
