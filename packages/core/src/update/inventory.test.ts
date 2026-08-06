import { describe, expect, it, vi, afterEach } from 'vitest';
import type { HostExecutor } from '../host/executor.js';
import {
  adviseInventory,
  collectCatalogSoftwareUpgrades,
  collectInventory,
  lookupOsvVulns,
} from './inventory.js';
// HostExecutor is structural — tests use minimal mocks

describe('inventory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets real candidate from apt list --upgradable', async () => {
    const smart = {
      executeEnabled: () => true,
      isRoot: () => true,
      runCommand: async (argv: string[]) => {
        const joined = argv.join(' ');
        if (joined.includes('apt list --upgradable')) {
          return {
            exitCode: 0,
            stdout:
              'openssl/jammy-updates 3.0.2-0ubuntu1.18 amd64 [upgradable from: 3.0.2-0ubuntu1.12]\n',
            stderr: '',
            argv,
            dryRun: false,
          };
        }
        if (joined.includes('apt-cache policy') || joined.includes('dpkg-query')) {
          return {
            exitCode: 0,
            stdout:
              'openssl\t3.0.2-0ubuntu1.12\t3.0.2-0ubuntu1.18\nbash\t5.1-6ubuntu1\t5.1-6ubuntu1\n',
            stderr: '',
            argv,
            dryRun: false,
          };
        }
        return { exitCode: 0, stdout: '', stderr: '', argv, dryRun: false };
      },
    } as unknown as HostExecutor;

    const { items, meta } = await collectInventory(smart);
    const openssl = items.find((i) => i.packageName === 'openssl');
    expect(openssl?.currentVersion).toBe('3.0.2-0ubuntu1.12');
    expect(openssl?.candidateVersion).toBe('3.0.2-0ubuntu1.18');
    expect(openssl?.candidateVersion).not.toBe(openssl?.currentVersion);
    expect(meta.upgradableCount).toBeGreaterThanOrEqual(1);

    const advice = adviseInventory(items);
    const oa = advice.find((a) => a.packageName === 'openssl');
    expect(oa?.advice).not.toBe('skip');
    expect(oa?.candidateVersion).toBe('3.0.2-0ubuntu1.18');

    const bash = advice.find((a) => a.packageName === 'bash');
    expect(bash?.currentVersion).toBe(bash?.candidateVersion);
    expect(bash?.advice).toBe('skip');
  });

  it('does not invent candidate when policy equals installed', async () => {
    const host = {
      executeEnabled: () => true,
      isRoot: () => true,
      runCommand: async (argv: string[]) => {
        const joined = argv.join(' ');
        if (joined.includes('apt list --upgradable')) {
          return { exitCode: 0, stdout: '', stderr: '', argv, dryRun: false };
        }
        return {
          exitCode: 0,
          stdout: 'curl\t7.81.0-1\t7.81.0-1\n',
          stderr: '',
          argv,
          dryRun: false,
        };
      },
    } as unknown as HostExecutor;

    const { items, meta } = await collectInventory(host);
    const curl = items.find((i) => i.packageName === 'curl');
    expect(curl?.currentVersion).toBe('7.81.0-1');
    expect(curl?.candidateVersion).toBe('7.81.0-1');
    expect(meta.upgradableCount).toBe(0);
  });

  it('collectCatalogSoftwareUpgrades returns installed catalog rows only', async () => {
    const host = {
      executeEnabled: () => false,
      isRoot: () => false,
      runCommand: async (argv: string[]) => {
        const joined = argv.join(' ');
        // Batch upgrades script: one tab row per package in the for-loop
        if (joined.includes('apt-cache policy') && joined.includes('for p in')) {
          const m = joined.match(/for p in (.+?); do/s);
          const pkgs =
            m?.[1]?.match(/"([^"]+)"/g)?.map((x) => x.replace(/"/g, '')) ?? [];
          const lines = pkgs.map((p) => {
            if (p === 'nginx') return 'nginx\t1.24.0-1\t1.24.0-2';
            if (p === 'redis-server') return 'redis-server\t5:7.0.0\t5:7.0.0';
            return `${p}\t(none)\t(none)`;
          });
          return {
            exitCode: 0,
            stdout: `${lines.join('\n')}\n`,
            stderr: '',
            argv,
            dryRun: false,
          };
        }
        return { exitCode: 0, stdout: '', stderr: '', argv, dryRun: false };
      },
    } as unknown as HostExecutor;

    const items = await collectCatalogSoftwareUpgrades(host);
    expect(items.every((i) => i.installed)).toBe(true);
    expect(items.some((i) => i.id === 'nginx' && i.upgradable)).toBe(true);
    expect(items.some((i) => i.id === 'redis-server' && !i.upgradable)).toBe(
      true,
    );
    // Uninstalled packages must not appear
    expect(items.every((i) => i.currentVersion)).toBe(true);
  });

  it('lookupOsvVulns returns ids from mock API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          vulns: [{ id: 'CVE-2024-TEST', severity: [{ score: 'HIGH' }] }],
        }),
      })),
    );
    const ids = await lookupOsvVulns('openssl', '3.0.0');
    expect(ids.some((i) => i.includes('CVE-2024-TEST'))).toBe(true);
  });

  it('lookupOsvVulns returns empty on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(await lookupOsvVulns('x', '1')).toEqual([]);
  });

  it('covers no-execute apt path, security line, policy fail, candidate none', async () => {
    const host = {
      executeEnabled: () => false,
      isRoot: () => false,
      runCommand: async (argv: string[]) => {
        const joined = argv.join(' ');
        if (joined.includes('apt list --upgradable')) {
          return {
            exitCode: 0,
            stdout:
              'libssl3/jammy-security 3.0.2-0ubuntu1.19 amd64 [upgradable from: 3.0.2-0ubuntu1.10]\n' +
              'garbage line without match\n' +
              '///bad\n',
            stderr: '',
            argv,
            dryRun: false,
          };
        }
        if (joined.includes('dpkg-query') || joined.includes('apt-cache')) {
          return {
            exitCode: 0,
            stdout:
              'libssl3\t3.0.2-0ubuntu1.10\t3.0.2-0ubuntu1.19\n' +
              'foo\t1.0\t(none)\n' +
              'bar\t2.0\t\n' +
              '\t\t\n',
            stderr: '',
            argv,
            dryRun: false,
          };
        }
        return { exitCode: 0, stdout: '', stderr: '', argv, dryRun: false };
      },
    } as unknown as HostExecutor;
    const { items, meta } = await collectInventory(host);
    expect(meta.notes.some((n) => n.length > 0)).toBe(true);
    const lib = items.find((i) => i.packageName === 'libssl3');
    expect(lib?.hasSecurityFix).toBe(true);
    expect(items.find((i) => i.packageName === 'foo')?.candidateVersion).toBe('1.0');
    expect(meta.source === 'mixed' || meta.source === 'apt').toBe(true);

    const empty = {
      executeEnabled: () => true,
      runCommand: async (argv: string[]) => {
        const joined = argv.join(' ');
        if (joined.includes('apt list')) {
          return { exitCode: 1, stdout: '', stderr: 'err', argv, dryRun: false };
        }
        return { exitCode: 1, stdout: '', stderr: 'policy fail', argv, dryRun: false };
      },
    } as unknown as HostExecutor;
    const none = await collectInventory(empty);
    expect(none.meta.source).toBe('dpkg-only');
    expect(none.items.length).toBe(0);
  });
});
