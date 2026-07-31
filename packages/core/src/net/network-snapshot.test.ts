import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { collectNetworkSnapshot } from './network-snapshot.js';
import { LocalHostExecutor } from '../host/executor.js';

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.executeEnabled !== false,
    isRoot: () => opts.isRoot === true,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => {
      const partial = opts.run?.(argv) ?? {};
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
        ...partial,
      };
    },
  };
}

const ADDR_JSON = JSON.stringify([
  {
    ifindex: 1,
    ifname: 'lo',
    flags: ['LOOPBACK', 'UP'],
    mtu: 65536,
    operstate: 'UNKNOWN',
    address: '00:00:00:00:00:00',
    link_type: 'loopback',
    addr_info: [
      { family: 'inet', local: '127.0.0.1', prefixlen: 8, scope: 'host' },
    ],
  },
  {
    ifindex: 2,
    ifname: 'eth0',
    flags: ['BROADCAST', 'MULTICAST', 'UP'],
    mtu: 1500,
    operstate: 'UP',
    address: 'aa:bb:cc:dd:ee:ff',
    link_type: 'ether',
    addr_info: [
      { family: 'inet', local: '10.0.0.5', prefixlen: 24, scope: 'global' },
    ],
  },
]);

const ROUTE_JSON = JSON.stringify([
  {
    dst: 'default',
    gateway: '10.0.0.1',
    dev: 'eth0',
    protocol: 'dhcp',
    metric: 100,
  },
  {
    dst: '10.0.0.0/24',
    dev: 'eth0',
    protocol: 'kernel',
    scope: 'link',
  },
]);

const LINK_JSON = JSON.stringify([
  {
    ifindex: 2,
    ifname: 'eth0',
    stats64: {
      rx: { bytes: 1000, packets: 10, errors: 0 },
      tx: { bytes: 2000, packets: 20, errors: 0 },
    },
  },
]);

describe('collectNetworkSnapshot', () => {
  it('parses ip -j addr/route and sets caps from execute/root', async () => {
    const host = mockHost({
      executeEnabled: false,
      isRoot: false,
      run: (argv) => {
        const s = argv.join(' ');
        if (argv[0] === 'systemctl') {
          if (s.includes('NetworkManager')) return { stdout: 'inactive\n' };
          if (s.includes('systemd-networkd')) return { stdout: 'active\n' };
        }
        if (argv[0] === 'ip' && argv.includes('addr') && argv.includes('-j')) {
          return { stdout: ADDR_JSON, exitCode: 0 };
        }
        if (argv[0] === 'ip' && argv.includes('link')) {
          return { stdout: LINK_JSON, exitCode: 0 };
        }
        if (argv[0] === 'ip' && argv.includes('route')) {
          return { stdout: ROUTE_JSON, exitCode: 0 };
        }
        if (argv[0] === 'cat' && argv.includes('/etc/resolv.conf')) {
          return {
            stdout: 'nameserver 1.1.1.1\nnameserver 127.0.0.53\nsearch lan\n',
            exitCode: 0,
          };
        }
        if (s.includes('resolvectl')) {
          return {
            stdout: 'Current DNS Server: 8.8.8.8\nDNS Servers: 8.8.8.8 1.0.0.1\n',
            exitCode: 0,
          };
        }
        return { stdout: '', exitCode: 0 };
      },
    });

    const snap = await collectNetworkSnapshot(host);
    expect(snap.ok).toBe(true);
    expect(snap.interfaces.some((i) => i.name === 'eth0')).toBe(true);
    expect(snap.interfaces.some((i) => i.isLoopback)).toBe(true);
    expect(snap.defaultGateway).toBe('10.0.0.1');
    expect(snap.defaultDev).toBe('eth0');
    expect(snap.interfaces.find((i) => i.name === 'eth0')?.isDefaultEgress).toBe(true);
    expect(snap.caps.executeEnabled).toBe(false);
    expect(snap.caps.isRoot).toBe(false);
    expect(snap.caps.canMutate).toBe(false);
    expect(snap.backend.hasIp).toBe(true);
    expect(snap.backend.networkd).toBe('active');
    // uplink preferred over stub
    expect(snap.dns.nameservers).toContain('8.8.8.8');
    expect(snap.dns.nameservers).not.toContain('127.0.0.53');
  });

  it('canMutate true only when execute+root', async () => {
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      run: (argv) => {
        if (argv[0] === 'systemctl') return { stdout: 'inactive\n' };
        if (argv[0] === 'ip' && argv.includes('addr') && argv.includes('-j')) {
          return { stdout: ADDR_JSON };
        }
        if (argv[0] === 'ip' && argv.includes('route')) return { stdout: ROUTE_JSON };
        if (argv[0] === 'ip' && argv.includes('link')) return { stdout: LINK_JSON };
        if (argv[0] === 'cat') return { stdout: 'nameserver 9.9.9.9\n' };
        return {};
      },
    });
    const snap = await collectNetworkSnapshot(host);
    expect(snap.caps.canMutate).toBe(true);
    expect(snap.caps.executeEnabled).toBe(true);
    expect(snap.caps.isRoot).toBe(true);
  });

  it('handles ip -j failure with notes and still returns structure', async () => {
    const host = mockHost({
      executeEnabled: false,
      run: (argv) => {
        if (argv[0] === 'systemctl') return { stdout: 'unknown\n', exitCode: 0 };
        if (argv[0] === 'ip') {
          return { exitCode: 1, stderr: 'ip: command not found' };
        }
        if (argv[0] === 'cat') {
          return { exitCode: 1, stderr: 'no resolv' };
        }
        return {};
      },
    });
    const snap = await collectNetworkSnapshot(host);
    expect(snap.caps.canMutate).toBe(false);
    expect(snap.notes.length).toBeGreaterThan(0);
    expect(Array.isArray(snap.interfaces)).toBe(true);
    expect(Array.isArray(snap.routes)).toBe(true);
  });

  it('NM active path extracts connection DNS and canApply', async () => {
    const host = mockHost({
      executeEnabled: true,
      isRoot: false,
      run: (argv) => {
        const s = argv.join(' ');
        if (argv[0] === 'systemctl') {
          if (s.includes('NetworkManager')) return { stdout: 'active\n' };
          return { stdout: 'inactive\n' };
        }
        if (argv[0] === 'ip' && argv.includes('addr') && argv.includes('-j')) {
          return { stdout: ADDR_JSON };
        }
        if (argv[0] === 'ip' && argv.includes('route')) return { stdout: ROUTE_JSON };
        if (argv[0] === 'ip' && argv.includes('link')) return { stdout: '[]' };
        if (argv[0] === 'cat') return { stdout: 'nameserver 127.0.0.53\n' };
        if (argv[0] === 'nmcli' && s.includes('connection show --active')) {
          return { stdout: 'Wired connection 1:eth0:802-3-ethernet\n', exitCode: 0 };
        }
        if (argv[0] === 'nmcli' && s.includes('connection show')) {
          return {
            stdout: '1.1.1.1 8.8.8.8\nlan\nyes\nauto\n',
            exitCode: 0,
          };
        }
        if (argv[0] === 'nmcli' && s.includes('device show')) {
          return { stdout: '1.1.1.1\n', exitCode: 0 };
        }
        return {};
      },
    });
    const snap = await collectNetworkSnapshot(host);
    expect(snap.dns.mode).toBe('networkmanager');
    expect(snap.dns.canApply).toBe(true);
    expect(snap.dns.connection).toBeTruthy();
    expect(snap.dns.nameservers.length).toBeGreaterThan(0);
    expect(snap.caps.canMutate).toBe(false); // root false
  });

  it('includeRaw attaches truncated raw dumps', async () => {
    const host = mockHost({
      run: (argv) => {
        if (argv[0] === 'systemctl') return { stdout: 'inactive\n' };
        if (argv[0] === 'ip' && argv.includes('-j') && argv.includes('addr')) {
          return { stdout: ADDR_JSON };
        }
        if (argv[0] === 'ip' && argv.includes('-j') && argv.includes('route')) {
          return { stdout: ROUTE_JSON };
        }
        if (argv[0] === 'ip' && argv.includes('link')) return { stdout: '[]' };
        if (argv[0] === 'ip' && argv.includes('addr')) return { stdout: '1: lo: <LOOPBACK>\n' };
        if (argv[0] === 'ip' && argv.includes('route')) return { stdout: 'default via 10.0.0.1\n' };
        if (argv[0] === 'cat') return { stdout: 'nameserver 1.1.1.1\n' };
        return {};
      },
    });
    const snap = await collectNetworkSnapshot(host, { includeRaw: true });
    expect(snap.raw?.addr).toBeTruthy();
    expect(snap.raw?.route).toBeTruthy();
  });

  it('LocalHostExecutor executeEnabled:false yields canMutate false on real probe', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const snap = await collectNetworkSnapshot(host);
    expect(snap.caps.executeEnabled).toBe(false);
    expect(snap.caps.canMutate).toBe(false);
    expect(typeof snap.at).toBe('string');
  });
});
