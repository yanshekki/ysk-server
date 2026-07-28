import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from './executor.js';
import { collectHostOverview, enableHostNtp, _hostOverviewTest } from './host-overview.js';

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  commands?: Record<string, RunResult>;
}): HostExecutor {
  return {
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: 'active',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => {
      const key = argv.join(' ');
      for (const [k, v] of Object.entries(opts.commands ?? {})) {
        if (key.includes(k) || key === k) return { ...v, argv, dryRun: false };
      }
      // defaults for common probes
      if (argv[0] === 'hostname') {
        return { stdout: 'test-host\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (argv[0] === 'timedatectl' && argv[1] === 'show') {
        return {
          stdout: 'Timezone=Asia/Hong_Kong\nNTP=yes\nNTPSynchronized=yes\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (argv[0] === 'df') {
        return {
          stdout:
            'Filesystem     Type  Size  Used Avail Use% Mounted on\n/dev/sda1      ext4  100G   40G   60G  40% /\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (argv[0] === 'systemctl' && argv[1] === 'get-default') {
        return {
          stdout: 'multi-user.target\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (argv[0] === 'uname') {
        return { stdout: '6.8.0-test\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
    pathExists: () => false,
    isRoot: () => Boolean(opts.isRoot),
    executeEnabled: () => Boolean(opts.executeEnabled),
  };
}

describe('host overview helpers', () => {
  it('parses timedatectl show', () => {
    const p = _hostOverviewTest.parseTimedatectlShow(
      'Timezone=Asia/Hong_Kong\nNTP=yes\nNTPSynchronized=no\n',
    );
    expect(p.timezone).toBe('Asia/Hong_Kong');
    expect(p.ntpEnabled).toBe(true);
    expect(p.ntpSynchronized).toBe(false);
  });

  it('parses df -hT', () => {
    const rows = _hostOverviewTest.parseDf(
      'Filesystem Type Size Used Avail Use% Mounted on\n/dev/sda1 ext4 100G 40G 60G 40% /\ntmpfs tmpfs 1G 0 1G 0% /run\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].mount).toBe('/');
    expect(rows[0].usePct).toBe(40);
  });
});

describe('collectHostOverview', () => {
  it('returns structured overview with caps', async () => {
    const o = await collectHostOverview(
      mockHost({ executeEnabled: false, isRoot: false }),
    );
    expect(o.identity.hostname).toBeTruthy();
    expect(o.identity.timezone).toBe('Asia/Hong_Kong');
    expect(o.runtime.cpus).toBeGreaterThan(0);
    expect(o.disks.some((d) => d.mount === '/')).toBe(true);
    expect(o.boot.defaultTarget).toBe('multi-user.target');
    expect(o.caps.canPower).toBe(false);
    expect(o.caps.canIdentity).toBe(false);
    expect(o.collectedAt).toBeTruthy();
  });

  it('canPower when execute+root', async () => {
    const o = await collectHostOverview(mockHost({ executeEnabled: true, isRoot: true }));
    expect(o.caps.canPower).toBe(true);
  });
});

describe('enableHostNtp', () => {
  it('blocks without execute', async () => {
    const r = await enableHostNtp(mockHost({ executeEnabled: false, isRoot: true }));
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('runs timedatectl set-ntp when allowed', async () => {
    const r = await enableHostNtp(mockHost({ executeEnabled: true, isRoot: true }));
    expect(r.ok).toBe(true);
  });
});
