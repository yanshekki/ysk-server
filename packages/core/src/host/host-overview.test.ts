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

  it('parses pretty hostname from status and machine-info', () => {
    expect(
      _hostOverviewTest.parsePrettyHostnameFromStatus(
        ' Static hostname: box\n Pretty hostname: YSK Panel\n',
      ),
    ).toBe('YSK Panel');
    expect(
      _hostOverviewTest.parsePrettyHostnameFromMachineInfo(
        'PRETTY_HOSTNAME="Friendly Host"\nICON_NAME=computer\n',
      ),
    ).toBe('Friendly Host');
  });

  it('parses df -hT', () => {
    const rows = _hostOverviewTest.parseDf(
      'Filesystem Type Size Used Avail Use% Mounted on\n/dev/sda1 ext4 100G 40G 60G 40% /\ntmpfs tmpfs 1G 0 1G 0% /run\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].mount).toBe('/');
    expect(rows[0].usePct).toBe(40);
  });

  it('parseTimedatectlShow bool variants and empty df', () => {
    const p = _hostOverviewTest.parseTimedatectlShow(
      'Timezone=UTC\nNetworkTimeProtocol=true\nNTPSynchronized=0\nbadline\n=novalue\n',
    );
    expect(p.timezone).toBe('UTC');
    expect(p.ntpEnabled).toBe(true);
    expect(p.ntpSynchronized).toBe(false);
    const p2 = _hostOverviewTest.parseTimedatectlShow('NTP=false\nNTPSynchronized=1\n');
    expect(p2.ntpEnabled).toBe(false);
    expect(p2.ntpSynchronized).toBe(true);
    const p3 = _hostOverviewTest.parseTimedatectlShow('NTP=maybe\n');
    expect(p3.ntpEnabled).toBeNull();
    expect(_hostOverviewTest.parseDf('')).toEqual([]);
    expect(_hostOverviewTest.parseDf('Filesystem only\n')).toEqual([]);
    const mixed = _hostOverviewTest.parseDf(
      [
        'Filesystem Type Size Used Avail Use% Mounted on',
        '/dev/sda1 ext4 100G 40G 60G 40% /',
        '/dev/sdb1 ext4 10G 1G 9G xx% /data',
        'short line',
        'overlay overlay 1G 0 1G 0% /var/lib/docker',
        'squashfs squashfs 1G 0 1G 0% /snap/core',
        'devtmpfs devtmpfs 1G 0 1G 0% /dev',
        '/dev/nvme0n1p1 vfat 512M 10M 500M 2% /boot/efi',
      ].join('\n'),
    );
    expect(mixed.some((r) => r.mount === '/')).toBe(true);
    expect(mixed.some((r) => r.usePct === null)).toBe(true);
    expect(Array.isArray(_hostOverviewTest.readResolvers())).toBe(true);
    // pending shutdown — usually null in CI
    expect(
      _hostOverviewTest.readPendingShutdown() === null ||
        typeof _hostOverviewTest.readPendingShutdown() === 'object',
    ).toBe(true);
  });
});

describe('collectHostOverview', () => {
  it('returns structured overview with caps', async () => {
    const o = await collectHostOverview(
      mockHost({
        executeEnabled: false,
        isRoot: false,
        commands: {
          'hostnamectl hostname --pretty': {
            stdout: 'Display Name\n',
            stderr: '',
            exitCode: 0,
            argv: [],
            dryRun: false,
          },
        },
      }),
    );
    expect(o.identity.hostname).toBeTruthy();
    expect(o.identity.prettyHostname).toBe('Display Name');
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

  it('fail-soft command errors and status NTP parse', async () => {
    const host = mockHost({
      executeEnabled: false,
      isRoot: false,
      commands: {
        hostname: { stdout: '', stderr: 'err', exitCode: 1, argv: [], dryRun: false },
        'hostnamectl hostname --pretty': {
          stdout: 'Pretty Host\n',
          stderr: '',
          exitCode: 0,
          argv: [],
          dryRun: false,
        },
        'hostnamectl show': {
          stdout: 'Pretty Host\n',
          stderr: '',
          exitCode: 0,
          argv: [],
          dryRun: false,
        },
        'timedatectl show': {
          stdout: '',
          stderr: 'fail',
          exitCode: 1,
          argv: [],
          dryRun: false,
        },
        'timedatectl status': {
          stdout: 'System clock synchronized: yes\nNTP service: active\n',
          stderr: '',
          exitCode: 0,
          argv: [],
          dryRun: false,
        },
        'uname -r': { stdout: '', stderr: '', exitCode: 1, argv: [], dryRun: false },
        'get-default': { stdout: '', stderr: '', exitCode: 1, argv: [], dryRun: false },
        'df -hT': { stdout: '', stderr: '', exitCode: 1, argv: [], dryRun: false },
        'hostname -I': {
          stdout: '10.0.0.5 2001:db8::1\n',
          stderr: '',
          exitCode: 0,
          argv: [],
          dryRun: false,
        },
      },
    });
    // force throws on some paths via custom runCommand
    const throwing: typeof host = {
      ...host,
      runCommand: async (argv) => {
        if (argv[0] === 'hostname' && argv.length === 1) throw new Error('hn');
        if (argv[0] === 'hostnamectl') throw new Error('hc');
        if (argv[0] === 'uname') throw new Error('un');
        if (argv[0] === 'systemctl') throw new Error('sc');
        if (argv[0] === 'df') throw new Error('df');
        return host.runCommand(argv);
      },
    };
    const o = await collectHostOverview(throwing);
    expect(o.identity.hostname).toBeTruthy();
    expect(o.time.ntpSynchronized === true || o.time.ntpSynchronized === null).toBe(true);
    expect(o.collectedAt).toBeTruthy();
  });
});

describe('enableHostNtp', () => {
  it('blocks without execute', async () => {
    const r = await enableHostNtp(mockHost({ executeEnabled: false, isRoot: true }));
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('blocks without root', async () => {
    const r = await enableHostNtp(mockHost({ executeEnabled: true, isRoot: false }));
    expect(r.blocked).toBe(true);
  });

  it('runs timedatectl set-ntp when allowed', async () => {
    const r = await enableHostNtp(mockHost({ executeEnabled: true, isRoot: true }));
    expect(r.ok).toBe(true);
  });

  it('reports failure when timedatectl fails', async () => {
    const r = await enableHostNtp(
      mockHost({
        executeEnabled: true,
        isRoot: true,
        commands: {
          'set-ntp': {
            stdout: '',
            stderr: 'permission',
            exitCode: 1,
            argv: [],
            dryRun: false,
          },
        },
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.notes.length).toBeGreaterThan(0);
  });
});
