import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { networkAddAddr, networkSetLink } from './network-apply.js';

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
    expect(calls[0]).toEqual(['ip', 'addr', 'add', '10.0.0.5/24', 'dev', 'eth0']);
  });

  it('refuses lo', async () => {
    const r = await networkAddAddr({
      host: mockHost({ executeEnabled: true, isRoot: true }),
      ifname: 'lo',
      cidr: '10.0.0.1/32',
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

  it('downs with confirm', async () => {
    const r = await networkSetLink({
      host: mockHost({ executeEnabled: true, isRoot: true }),
      ifname: 'eth0',
      action: 'down',
      confirmName: 'eth0',
    });
    expect(r.ok).toBe(true);
  });
});
