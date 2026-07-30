import { describe, expect, it, vi, afterEach } from 'vitest';
import type { HostExecutor } from '../host/executor.js';
import { adviseInventory, collectInventory, lookupOsvVulns } from './inventory.js';
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
});
