import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { makeHost } from '../test/host.js';
import {
  applyFail2banPolicy,
  fail2banBanIp,
  fail2banService,
  getFail2banDeepStatus,
  writeFail2banJailLocal,
} from './fail2ban-ops.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.executeEnabled === true,
    isRoot: () => opts.isRoot === true,
    pathExists: (p) => p.includes('fail2ban') || p.includes('systemctl'),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: 'inactive',
      stderr: '',
      exitCode: 3,
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

describe('fail2ban-ops honesty gates', () => {
  it('fail2banService blocks without execute', async () => {
    const host = mockHost({ executeEnabled: false, isRoot: true });
    const r = await fail2banService(host, 'restart');
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('fail2banService runs systemctl when execute enabled', async () => {
    const calls: string[][] = [];
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      run: (argv) => {
        calls.push(argv);
        return { exitCode: 0 };
      },
    });
    const r = await fail2banService(host, 'reload');
    expect(r.ok).toBe(true);
    expect(calls[0]?.slice(0, 3)).toEqual(['systemctl', 'reload', 'fail2ban']);

    const en = await fail2banService(host, 'enable');
    expect(en.ok).toBe(true);
    expect(calls.some((a) => a.includes('--now'))).toBe(true);
  });

  it('fail2banBanIp blocks without execute; rejects bad IP; bans when allowed', async () => {
    const blocked = await fail2banBanIp(
      mockHost({ executeEnabled: false }),
      'sshd',
      '1.2.3.4',
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);

    const bad = await fail2banBanIp(
      mockHost({ executeEnabled: true }),
      'sshd',
      'not-an-ip',
    );
    expect(bad.ok).toBe(false);

    const calls: string[][] = [];
    const ok = await fail2banBanIp(
      mockHost({
        executeEnabled: true,
        run: (argv) => {
          calls.push(argv);
          return { exitCode: 0 };
        },
      }),
      'sshd;rm',
      '203.0.113.8',
    );
    expect(ok.ok).toBe(true);
    expect(calls[0]).toEqual([
      'fail2ban-client',
      'set',
      'sshdrm',
      'banip',
      '203.0.113.8',
    ]);
  });

  it('applyFail2banPolicy writes jail.local; apply=true without execute → blocked', async () => {
    const { host, dir, cleanup } = makeHost({ executeEnabled: false });
    cleanups.push(cleanup);

    const writtenOnly = await applyFail2banPolicy({
      dataDir: dir,
      host,
      policy: {
        bantime: '2h',
        findtime: '10m',
        maxretry: 4,
        jails: ['sshd', 'postfix'],
      },
      apply: false,
    });
    expect(writtenOnly.ok).toBe(true);
    expect(writtenOnly.apply_status).toBe('written');
    expect(existsSync(writtenOnly.written[0]!)).toBe(true);
    expect(readFileSync(writtenOnly.written[0]!, 'utf8')).toContain('bantime = 2h');

    const blocked = await applyFail2banPolicy({
      dataDir: dir,
      host,
      policy: {
        bantime: '1h',
        findtime: '10m',
        maxretry: 5,
        jails: ['sshd'],
      },
      apply: true,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(blocked.requiresExecute).toBe(true);
    expect(blocked.apply_status).toBe('blocked');
    // still wrote managed file first
    expect(blocked.written.length).toBe(1);
    expect(existsSync(join(dir, 'fail2ban', 'jail.local'))).toBe(true);
  });

  it('applyFail2banPolicy with execute+root copies and reloads', async () => {
    const { dir, cleanup } = makeHost();
    cleanups.push(cleanup);
    const calls: string[][] = [];
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      run: (argv) => {
        calls.push(argv);
        if (argv[0] === 'systemctl' && argv.includes('reload')) {
          return { exitCode: 0 };
        }
        return { exitCode: 0 };
      },
    });
    const r = await applyFail2banPolicy({
      dataDir: dir,
      host,
      policy: {
        bantime: '1h',
        findtime: '10m',
        maxretry: 5,
        jails: ['sshd'],
      },
      apply: true,
    });
    expect(r.apply_status).toBe('applied');
    expect(r.ok).toBe(true);
    expect(calls.some((a) => a[0] === 'cp')).toBe(true);
  });

  it('getFail2banDeepStatus exposes catalog and caps', async () => {
    const { dir, cleanup } = makeHost({ executeEnabled: false });
    cleanups.push(cleanup);
    writeFail2banJailLocal(dir, {
      bantime: '1h',
      findtime: '10m',
      maxretry: 5,
      jails: ['sshd'],
    });
    const host = mockHost({
      executeEnabled: false,
      isRoot: false,
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('fail2ban-client') || s.includes('command -v')) {
          return { stdout: '', exitCode: 1 };
        }
        if (argv[0] === 'systemctl') {
          return { stdout: 'inactive\n', exitCode: 3 };
        }
        return {};
      },
    });
    const st = await getFail2banDeepStatus({ host, dataDir: dir });
    expect(st.catalog.length).toBeGreaterThan(3);
    expect(st.executeEnabled).toBe(false);
    expect(Array.isArray(st.banned)).toBe(true);
    expect(Array.isArray(st.ignoreIps)).toBe(true);
  });
});
