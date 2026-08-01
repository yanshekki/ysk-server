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

describe('network validation branches', () => {
  it('rejects invalid iface, lo, and bad cidr/dst across mutators', async () => {
    const host = mockHost({ executeEnabled: true, isRoot: true });
    expect((await networkAddAddr({ host, ifname: 'bad name', cidr: '10.0.0.1/24' })).ok).toBe(
      false,
    );
    expect((await networkAddAddr({ host, ifname: 'lo', cidr: '10.0.0.1/24' })).ok).toBe(false);
    expect((await networkAddAddr({ host, ifname: 'eth0', cidr: 'not-cidr' })).ok).toBe(false);
    expect((await networkDelAddr({ host, ifname: 'bad!', cidr: '10.0.0.1/24' })).ok).toBe(false);
    expect((await networkDelAddr({ host, ifname: 'eth0', cidr: 'x' })).ok).toBe(false);
    expect((await networkSetLink({ host, ifname: 'bad name', action: 'up' })).ok).toBe(false);
    expect((await networkSetLink({ host, ifname: 'lo', action: 'down', confirmName: 'lo' })).ok).toBe(
      false,
    );
    expect((await networkSetLink({ host, ifname: 'eth0', action: 'down' })).ok).toBe(false);
    expect((await networkSetLink({ host, ifname: 'eth0', mtu: 10 })).ok).toBe(false);
    expect((await networkSetLink({ host, ifname: 'eth0' })).ok).toBe(false);
    expect((await networkAddRoute({ host, dst: '10.0.0.0/8', gateway: 'not-ip' })).ok).toBe(false);
    expect((await networkAddRoute({ host, dst: '10.0.0.0/8', dev: 'bad name' })).ok).toBe(false);
    expect(
      (await networkDelRoute({ host, dst: '0.0.0.0/0', confirmDefault: false })).ok,
    ).toBe(false);
    expect((await networkDelRoute({ host, dst: 'default', confirmDefault: false })).ok).toBe(false);
    expect((await networkSetDns({ host, nameservers: ['not-ip'] })).ok).toBe(false);
    expect((await networkSetDns({ host, mode: 'static', nameservers: [] })).ok).toBe(false);
    // name sanitized to empty → invalid
    expect((await networkTestDns({ host, name: '!!!' })).ok).toBe(false);
    expect((await networkTestDns({ host, name: 'a'.repeat(300) })).ok).toBe(false);
  });

  it('setLink down with confirm + mtu fail/success paths', async () => {
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      run: async (argv) => {
        if (argv.includes('mtu') && argv.includes('99999')) return { exitCode: 1, stderr: 'bad mtu' };
        if (argv.includes('down')) return { exitCode: 1, stderr: 'down fail' };
        if (argv.includes('up')) return { exitCode: 1, stderr: 'up fail' };
        return {};
      },
    });
    expect(
      (
        await networkSetLink({
          host,
          ifname: 'eth0',
          action: 'down',
          confirmName: 'eth0',
          isDefaultEgress: true,
        })
      ).ok,
    ).toBe(false);
    expect((await networkSetLink({ host, ifname: 'eth0', action: 'up' })).ok).toBe(false);
    const mtuOk = await networkSetLink({
      host: mockHost({ executeEnabled: true, isRoot: true }),
      ifname: 'eth0',
      mtu: 1500,
    });
    expect(mtuOk.ok).toBe(true);
    expect(
      (
        await networkSetLink({
          host,
          ifname: 'eth0',
          mtu: 1500,
        })
      ).ok,
    ).toBe(true); // host mock returns {} for non-mtu-99999
  });
});

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

describe('network failure and persistent branches', () => {
  it('networkAddAddr persistent nm modify fail and up-fail live fallback', async () => {
    const modFail = await networkAddAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          if (argv.includes('modify')) return { exitCode: 1, stderr: 'mod fail' };
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.20/24',
      persistent: true,
    });
    expect(modFail.ok).toBe(false);

    let liveTried = false;
    const upFailLiveOk = await networkAddAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          if (argv.includes('modify')) return {};
          if (argv.includes('up') && argv[0] === 'nmcli') return { exitCode: 1, stderr: 'up fail' };
          if (argv[0] === 'ip' && argv.includes('add')) {
            liveTried = true;
            return {};
          }
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.21/24',
      persistent: true,
    });
    expect(liveTried).toBe(true);
    expect(upFailLiveOk.ok).toBe(true);
    expect(upFailLiveOk.ephemeral).toBe(true);

    const upFailLiveFail = await networkAddAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          if (argv.includes('modify')) return {};
          if (argv[0] === 'nmcli' && argv.includes('up')) return { exitCode: 1 };
          if (argv[0] === 'ip') return { exitCode: 1, stderr: 'ip fail' };
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.22/24',
      persistent: true,
    });
    expect(upFailLiveFail.ok).toBe(false);
  });

  it('networkAddAddr ephemeral fail and ipv6 persistent prop', async () => {
    const fail = await networkAddAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async () => ({ exitCode: 1, stderr: 'busy' }),
      }),
      ifname: 'eth0',
      cidr: '10.0.0.30/24',
    });
    expect(fail.ok).toBe(false);

    const v6 = await networkAddAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '2001:db8::1/64',
      persistent: true,
    });
    expect(v6.ok).toBe(true);
  });

  it('networkDelAddr persistent nm paths and del fail', async () => {
    const ok = await networkDelAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.5/24',
      persistent: true,
    });
    expect(ok.ok).toBe(true);

    const modFail = await networkDelAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          if (argv.includes('modify')) return { exitCode: 1, stderr: 'no' };
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.5/24',
      persistent: true,
    });
    expect(modFail.ok).toBe(true); // ip del still ok

    const noNm = await networkDelAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli') return { exitCode: 1 };
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.5/24',
      persistent: true,
    });
    expect(noNm.ok).toBe(true);

    const delFail = await networkDelAddr({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'ip') return { exitCode: 1, stderr: 'not found' };
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.5/24',
    });
    expect(delFail.ok).toBe(false);

    expect(
      (
        await networkDelAddr({
          host: mockHost({ executeEnabled: true, isRoot: true }),
          ifname: 'bad;iface',
          cidr: '10.0.0.1/32',
        })
      ).ok,
    ).toBe(false);
  });

  it('networkSetLink failure paths', async () => {
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      run: async () => ({ exitCode: 1, stderr: 'link err' }),
    });
    expect(
      (await networkSetLink({ host, ifname: 'eth0', action: 'down', confirmName: 'eth0' })).ok,
    ).toBe(false);
    expect((await networkSetLink({ host, ifname: 'eth0', action: 'up' })).ok).toBe(false);
    expect((await networkSetLink({ host, ifname: 'eth0', mtu: 9000 })).ok).toBe(false);
    expect(
      (
        await networkSetLink({
          host: mockHost({ executeEnabled: true, isRoot: true }),
          ifname: 'bad name',
          action: 'up',
        })
      ).ok,
    ).toBe(false);
  });

  it('networkAddRoute persistent static and failures', async () => {
    const staticR = await networkAddRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      dst: '10.99.0.0/16',
      gateway: '10.0.0.1',
      persistent: true,
    });
    expect(staticR.ok).toBe(true);

    const bareIp = await networkAddRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      dst: '10.88.0.1',
      persistent: true,
    });
    expect(bareIp.ok).toBe(true);

    const noGwDef = await networkAddRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      dst: 'default',
      confirmDefault: true,
      persistent: true,
    });
    expect(noGwDef.ok).toBe(false);

    const noNm = await networkAddRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async () => ({ exitCode: 1 }),
      }),
      dst: '10.1.0.0/16',
      persistent: true,
    });
    expect(noNm.blocked).toBe(true);

    const modFail = await networkAddRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          if (argv.includes('modify')) return { exitCode: 1, stderr: 'x' };
          return {};
        },
      }),
      dst: 'default',
      gateway: '10.0.0.1',
      confirmDefault: true,
      persistent: true,
    });
    expect(modFail.ok).toBe(false);

    const upFail = await networkAddRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          if (argv.includes('up')) return { exitCode: 1, stderr: 'up' };
          return {};
        },
      }),
      dst: '10.2.0.0/16',
      gateway: '10.0.0.1',
      persistent: true,
    });
    expect(upFail.ok).toBe(false);

    const ephFail = await networkAddRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async () => ({ exitCode: 1, stderr: 'exists' }),
      }),
      dst: '10.3.0.0/16',
      gateway: '10.0.0.1',
    });
    expect(ephFail.ok).toBe(false);

    expect(
      (
        await networkAddRoute({
          host: mockHost({ executeEnabled: true, isRoot: true }),
          dst: '10.0.0.0/8',
          dev: 'bad name',
        })
      ).ok,
    ).toBe(false);
  });

  it('networkDelRoute persistent default/static and del fail', async () => {
    const delDef = await networkDelRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      dst: 'default',
      confirmDefault: true,
      persistent: true,
    });
    expect(delDef.ok).toBe(true);

    const delStatic = await networkDelRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      dst: '10.40.0.1',
      gateway: '10.0.0.1',
      persistent: true,
    });
    expect(delStatic.ok).toBe(true);

    const modFail = await networkDelRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          if (argv.includes('modify')) return { exitCode: 1, stderr: 'm' };
          return {};
        },
      }),
      dst: 'default',
      confirmDefault: true,
      persistent: true,
    });
    expect(modFail.ok).toBe(true);

    const noNm = await networkDelRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli') return { exitCode: 1 };
          return {};
        },
      }),
      dst: '10.50.0.0/16',
      persistent: true,
    });
    expect(noNm.ok).toBe(true);

    const ipFail = await networkDelRoute({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'ip') return { exitCode: 1, stderr: 'no route' };
          return {};
        },
      }),
      dst: '10.60.0.0/16',
    });
    expect(ipFail.ok).toBe(false);

    expect(
      (
        await networkDelRoute({
          host: mockHost({ executeEnabled: true, isRoot: true }),
          dst: '10.0.0.0/8',
          dev: 'bad name',
        })
      ).ok,
    ).toBe(false);
  });

  it('networkSetDns connection resolution and failures', async () => {
    const byDevice = await networkSetDns({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActive();
          return {};
        },
      }),
      nameservers: ['1.1.1.1'],
      device: 'eth0',
    });
    expect(byDevice.ok).toBe(true);

    const named = await networkSetDns({
      host: mockHost({ executeEnabled: true, isRoot: true }),
      connection: 'Wired connection 1',
      nameservers: ['8.8.8.8'],
    });
    expect(named.ok).toBe(true);

    const noNm = await networkSetDns({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async () => ({ exitCode: 1 }),
      }),
      nameservers: ['1.1.1.1'],
    });
    expect(noNm.blocked).toBe(true);

    const emptyConn = await networkSetDns({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active'))
            return { exitCode: 0, stdout: 'lo:lo:loopback\n' };
          return {};
        },
      }),
      nameservers: ['1.1.1.1'],
    });
    expect(emptyConn.ok).toBe(false);

    const dhcpFail = await networkSetDns({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv.includes('modify')) return { exitCode: 1, stderr: 'mod' };
          return {};
        },
      }),
      connection: 'c1',
      mode: 'dhcp',
    });
    expect(dhcpFail.ok).toBe(false);

    const staticModFail = await networkSetDns({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv.includes('modify')) return { exitCode: 1, stderr: 'mod' };
          return {};
        },
      }),
      connection: 'c1',
      nameservers: ['1.1.1.1'],
    });
    expect(staticModFail.ok).toBe(false);

    const upFail = await networkSetDns({
      host: mockHost({
        executeEnabled: true,
        isRoot: true,
        run: async (argv) => {
          if (argv.includes('up')) return { exitCode: 1, stderr: 'up' };
          return {};
        },
      }),
      connection: 'c1',
      nameservers: ['1.1.1.1'],
    });
    expect(upFail.ok).toBe(false);

    const badSlash = await networkSetDns({
      host: mockHost({ executeEnabled: true, isRoot: true }),
      connection: 'c1',
      nameservers: ['1.1.1.1/32'],
    });
    expect(badSlash.ok).toBe(false);

    const tooMany = await networkSetDns({
      host: mockHost({ executeEnabled: true, isRoot: true }),
      connection: 'c1',
      nameservers: Array.from({ length: 9 }, (_, i) => `1.1.1.${i + 1}`),
    });
    expect(tooMany.ok).toBe(false);
  });

  it('networkTestDns invalid name and empty answers', async () => {
    expect(
      (
        await networkTestDns({
          host: mockHost({ executeEnabled: false }),
          name: '',
        })
      ).ok,
    ).toBe(false);

    const empty = await networkTestDns({
      host: mockHost({
        executeEnabled: false,
        run: async () => ({ exitCode: 0, stdout: '\n' }),
      }),
      name: 'empty.test',
    });
    expect(empty.ok).toBe(false);
  });
});
