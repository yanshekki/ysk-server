import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  networkAddAddr,
  networkDelAddr,
  networkSetLink,
  networkAddRoute,
  networkDelRoute,
  networkSetDns,
  networkTestDns,
} from './network-apply.js';

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  run?: (argv: string[]) => Promise<Partial<RunResult>>;
}): HostExecutor {
  return {
    runCommand: async (argv: string[]) => {
      const partial = opts.run ? await opts.run(argv) : {};
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
        ...partial,
      };
    },
    executeEnabled: () => opts.executeEnabled !== false,
    isRoot: () => opts.isRoot !== false,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    writeFile: async () => {},
    readFile: async () => '',
    listDir: async () => [],
    deletePath: async () => {},
    mkdirp: async () => {},
    pathExists: () => false,
  } as unknown as HostExecutor;
}

function nmActive(): Partial<RunResult> {
  return {
    exitCode: 0,
    stdout: 'Wired connection 1:eth0:802-3-ethernet\nlo:lo:loopback\n',
  };
}

describe('network honesty gate', () => {
  it('all mutators block without execute or root', async () => {
    const noExec = mockHost({ executeEnabled: false, isRoot: true });
    const noRoot = mockHost({ executeEnabled: true, isRoot: false });
    for (const host of [noExec, noRoot]) {
      const add = await networkAddAddr({
        host,
        ifname: 'eth0',
        cidr: '10.0.0.5/24',
      });
      expect(add.ok).toBe(false);
      expect(add.blocked).toBe(true);
      expect(add.executeEnabled).toBe(host.executeEnabled());
      expect(add.isRoot).toBe(host.isRoot());

      const del = await networkDelAddr({
        host,
        ifname: 'eth0',
        cidr: '10.0.0.5/24',
      });
      expect(del.blocked).toBe(true);

      const route = await networkAddRoute({
        host,
        dst: '10.9.0.0/16',
        gateway: '10.0.0.1',
      });
      expect(route.blocked).toBe(true);

      const delR = await networkDelRoute({
        host,
        dst: '10.9.0.0/16',
        confirmDefault: true,
      });
      expect(delR.blocked).toBe(true);

      const dns = await networkSetDns({
        host,
        nameservers: ['1.1.1.1'],
      });
      expect(dns.blocked).toBe(true);
    }
  });
});

describe('networkAddAddr', () => {
  it('blocks without execute', async () => {
    const r = await networkAddAddr({
      host: mockHost({ executeEnabled: false, isRoot: true }),
      ifname: 'eth0',
      cidr: '10.0.0.5/24',
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('adds address when allowed', async () => {
    const calls: string[][] = [];
    const r = await networkAddAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          calls.push(argv);
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.5/24',
    });
    expect(r.ok).toBe(true);
    expect(r.ephemeral).toBe(true);
    expect(r.persistent).toBe(false);
    expect(calls[0]).toEqual(['ip', 'addr', 'add', '10.0.0.5/24', 'dev', 'eth0']);
  });

  it('refuses lo and invalid iface/cidr', async () => {
    const host = mockHost({ executeEnabled: true, isRoot: true });
    expect(
      (await networkAddAddr({ host, ifname: 'lo', cidr: '10.0.0.1/32' })).ok,
    ).toBe(false);
    expect(
      (await networkAddAddr({ host, ifname: 'eth0;rm', cidr: '10.0.0.1/32' })).ok,
    ).toBe(false);
    expect(
      (await networkAddAddr({ host, ifname: 'eth0', cidr: 'not-a-cidr' })).ok,
    ).toBe(false);
  });

  it('persistent path uses nmcli when connection active', async () => {
    const calls: string[][] = [];
    const r = await networkAddAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          calls.push(argv);
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.8/24',
      persistent: true,
    });
    expect(r.ok).toBe(true);
    expect(r.persistent).toBe(true);
    expect(calls.some((c) => c.includes('connection') && c.includes('modify'))).toBe(
      true,
    );
  });

  it('persistent blocks when NM missing', async () => {
    const r = await networkAddAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli') return { exitCode: 1, stderr: 'no nm' };
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.9/24',
      persistent: true,
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });
});

describe('networkDelAddr', () => {
  it('deletes ephemeral address', async () => {
    const calls: string[][] = [];
    const r = await networkDelAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          calls.push(argv);
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.5/24',
    });
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(['ip', 'addr', 'del', '10.0.0.5/24', 'dev', 'eth0']);
  });

  it('refuses deleting loopback addresses', async () => {
    const r = await networkDelAddr({
      host: mockHost({ executeEnabled: true, isRoot: true }),
      ifname: 'lo',
      cidr: '127.0.0.1/8',
    });
    expect(r.ok).toBe(false);
  });
});

describe('networkSetLink', () => {
  it('requires confirmName for down', async () => {
    const r = await networkSetLink({
      host: mockHost({ executeEnabled: true, isRoot: true }),
      ifname: 'eth0',
      action: 'down',
    });
    expect(r.ok).toBe(false);
  });

  it('downs with confirm and ups link', async () => {
    const down = await networkSetLink({
      host: mockHost({ executeEnabled: true, isRoot: true }),
      ifname: 'eth0',
      action: 'down',
      confirmName: 'eth0',
      isDefaultEgress: true,
    });
    expect(down.ok).toBe(true);

    const up = await networkSetLink({
      host: mockHost({ executeEnabled: true, isRoot: true }),
      ifname: 'eth0',
      action: 'up',
    });
    expect(up.ok).toBe(true);
  });

  it('sets mtu and refuses invalid mtu / empty action', async () => {
    const host = mockHost({ executeEnabled: true, isRoot: true });
    const mtu = await networkSetLink({ host, ifname: 'eth0', mtu: 1500 });
    expect(mtu.ok).toBe(true);
    expect((await networkSetLink({ host, ifname: 'eth0', mtu: 10 })).ok).toBe(false);
    expect((await networkSetLink({ host, ifname: 'eth0' })).ok).toBe(false);
    expect(
      (await networkSetLink({ host, ifname: 'lo', action: 'down', confirmName: 'lo' }))
        .ok,
    ).toBe(false);
  });
});

describe('networkAddRoute / networkDelRoute', () => {
  it('requires confirmDefault for default route', async () => {
    const host = mockHost({ executeEnabled: true, isRoot: true });
    expect((await networkAddRoute({ host, dst: 'default', gateway: '1.1.1.1' })).ok).toBe(
      false,
    );
    expect((await networkDelRoute({ host, dst: '0.0.0.0/0' })).ok).toBe(false);
  });

  it('adds ephemeral route and rejects bad gateway', async () => {
    const host = mockHost({ executeEnabled: true, isRoot: true });
    expect(
      (
        await networkAddRoute({
          host,
          dst: '10.20.0.0/16',
          gateway: 'not-ip',
        })
      ).ok,
    ).toBe(false);

    const r = await networkAddRoute({
      host,
      dst: '10.20.0.0/16',
      gateway: '10.0.0.1',
      dev: 'eth0',
    });
    expect(r.ok).toBe(true);
    expect(r.ephemeral).toBe(true);
  });

  it('persistent default via nmcli', async () => {
    const r = await networkAddRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      dst: 'default',
      gateway: '10.0.0.1',
      confirmDefault: true,
      persistent: true,
    });
    expect(r.ok).toBe(true);
    expect(r.persistent).toBe(true);
  });

  it('deletes route with confirm', async () => {
    const r = await networkDelRoute({
      host: mockHost({ executeEnabled: true, isRoot: true }),
      dst: '10.30.0.0/16',
      gateway: '10.0.0.1',
      dev: 'eth0',
    });
    expect(r.ok).toBe(true);
  });
});

describe('networkSetDns / networkTestDns', () => {
  it('sets static DNS on active connection', async () => {
    const r = await networkSetDns({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      nameservers: ['1.1.1.1', '8.8.8.8'],
      search: ['example.com'],
      mode: 'static',
    });
    expect(r.ok).toBe(true);
    expect(r.persistent).toBe(true);
  });

  it('rejects invalid nameservers and empty static list', async () => {
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      run: async (argv) => {
        if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
        return {};
      },
    });
    expect((await networkSetDns({ host, nameservers: ['not-an-ip'] })).ok).toBe(false);
    expect((await networkSetDns({ host, nameservers: [] })).ok).toBe(false);
  });

  it('dhcp mode clears static DNS', async () => {
    const r = await networkSetDns({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      mode: 'dhcp',
    });
    expect(r.ok).toBe(true);
  });

  it('networkTestDns is read-only and works without execute', async () => {
    const r = await networkTestDns({
      host: mockHost({
        executeEnabled: false,
        isRoot: false,
        run: async () => ({
          exitCode: 0,
          stdout: '93.184.216.34 STREAM example.com\n',
        }),
      }),
      name: 'example.com',
    });
    expect(r.ok).toBe(true);
    expect((r.answers ?? []).length).toBeGreaterThan(0);

    const bad = await networkTestDns({
      host: mockHost({
        executeEnabled: false,
        run: async () => ({ exitCode: 2, stderr: 'not found' }),
      }),
      name: 'nope.invalid',
    });
    expect(bad.ok).toBe(false);
  });
});
