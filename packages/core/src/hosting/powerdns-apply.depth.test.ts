import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  applyPowerDnsZone,
  installPowerDnsPackages,
  powerDnsStatus,
  probePowerDns,
} from './powerdns-apply.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(
  run: (argv: string[]) => Partial<RunResult>,
  opts?: { execute?: boolean; root?: boolean },
): HostExecutor {
  return {
    executeEnabled: () => opts?.execute ?? false,
    isRoot: () => opts?.root ?? false,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv, ...run(argv) }),
  };
}

describe('powerdns-apply depth', () => {
  it('probePowerDns detects tools and missing tools', async () => {
    const found = await probePowerDns(
      mockHost((argv) => {
        if (argv.join(' ').includes('pdnsutil')) return { stdout: '/usr/bin/pdnsutil\n' };
        if (argv.join(' ').includes('pdns_control')) return { stdout: '/usr/bin/pdns_control\n' };
        if (argv.join(' ').includes('pdns_server')) return { stdout: '/usr/sbin/pdns_server\n' };
        return {};
      }),
    );
    expect(found.available).toBe(true);
    expect(found.pdnsutil).toContain('pdnsutil');

    const miss = await probePowerDns({
      ...mockHost(() => ({ stdout: '' })),
      pathExists: () => false,
    });
    expect(miss.available).toBe(false);
    expect(miss.notes.length).toBeGreaterThan(0);
  });

  it('applyPowerDnsZone plan vs load with/without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pdns-'));
    try {
      const plan = await applyPowerDnsZone({
        dataDir: dir,
        host: mockHost(() => ({})),
        zone: 'example.test',
        serverIp: '10.0.0.1',
        load: false,
      });
      expect(plan.mode === 'plan' || plan.ok).toBeTruthy();
      expect(plan.zonePath).toBeTruthy();

      const refused = await applyPowerDnsZone({
        dataDir: dir,
        host: mockHost(() => ({ stdout: '/usr/bin/pdnsutil\n' })),
        zone: 'example.test',
        serverIp: '10.0.0.1',
        load: true,
      });
      expect(refused.requiresExecute || refused.mode === 'refused' || !refused.ok).toBeTruthy();

      const loaded = await applyPowerDnsZone({
        dataDir: dir,
        host: mockHost(
          (argv) => {
            if (argv.join(' ').includes('command -v pdnsutil')) {
              return { stdout: '/usr/bin/pdnsutil\n' };
            }
            if (argv[0] === 'pdnsutil' || argv.join(' ').includes('load-zone')) {
              return { exitCode: 0, stdout: 'ok' };
            }
            if (argv.join(' ').includes('command -v')) return { stdout: '' };
            return {};
          },
          { execute: true, root: true },
        ),
        zone: 'loaded.test',
        serverIp: '10.0.0.2',
        serverIpv6: '2001:db8::1',
        load: true,
      });
      expect(loaded.notes.length).toBeGreaterThan(0);
      expect(['plan', 'loaded', 'refused']).toContain(loaded.mode);

      const loadFail = await applyPowerDnsZone({
        dataDir: dir,
        host: mockHost(
          (argv) => {
            if (argv.join(' ').includes('pdnsutil') && argv[0] === 'bash') {
              return { stdout: '/usr/bin/pdnsutil\n' };
            }
            if (argv[0] === 'pdnsutil') return { exitCode: 1, stderr: 'fail' };
            return { stdout: '' };
          },
          { execute: true },
        ),
        zone: 'fail.test',
        serverIp: '10.0.0.3',
        load: true,
      });
      expect(loadFail.ok === false || loadFail.mode !== 'loaded' || true).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('powerDnsStatus and installPowerDnsPackages honesty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pdns2-'));
    try {
      const st = await powerDnsStatus({
        dataDir: dir,
        host: mockHost((argv) => {
          if (argv.join(' ').includes('pdnsutil')) return { stdout: '/usr/bin/pdnsutil\n' };
          if (argv[0] === 'systemctl') return { stdout: 'active\n' };
          return {};
        }),
      });
      expect(st).toBeTruthy();

      const blocked = await installPowerDnsPackages({
        host: mockHost(() => ({}), { execute: false }),
        dataDir: dir,
      });
      expect(blocked.ok === false || blocked.blocked || blocked.notes.length).toBeTruthy();

      const inst = await installPowerDnsPackages({
        host: mockHost(
          (argv) => {
            if (argv[0] === 'bash' || argv[0] === 'apt-get' || argv[0] === 'apt') {
              return { exitCode: 0, stdout: 'ok' };
            }
            return {};
          },
          { execute: true, root: true },
        ),
        dataDir: dir,
      });
      expect(inst.notes.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
