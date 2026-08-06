import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  cmpSemver,
  discoverRuntimeVersions,
  resolveSoftwareVersionStatus,
} from './version-discovery.js';
import type { HostExecutor } from '../host/executor.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('version-discovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cmpSemver orders releases', () => {
    expect(cmpSemver('1.26.5', '1.22.0')).toBeGreaterThan(0);
    expect(cmpSemver('20', '18')).toBeGreaterThan(0);
  });

  it('discoverRuntimeVersions(go) uses go.dev JSON not a hardcoded pin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('go.dev')) {
          return {
            ok: true,
            text: async () =>
              JSON.stringify([
                { version: 'go1.99.1', stable: true },
                { version: 'go1.98.0', stable: true },
              ]),
          };
        }
        return { ok: false, text: async () => '' };
      }),
    );
    const r = await discoverRuntimeVersions('go');
    // Panel pin is minor (matches /usr/local/ysk/go/<minor>); full patch only in label
    expect(r.latestVersion).toBe('1.99');
    expect(r.candidates.some((c) => c.version === '1.99')).toBe(true);
    expect(r.candidates.find((c) => c.version === '1.99')?.label).toMatch(/1\.99\.1/);
    expect(r.source).toContain('go.dev');
  });

  it('discoverRuntimeVersions(node) picks majors from index.json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify([
            { version: 'v25.0.0', lts: false },
            { version: 'v24.1.0', lts: 'Krypton' },
            { version: 'v22.11.0', lts: 'Jod' },
          ]),
      })),
    );
    const r = await discoverRuntimeVersions('node');
    expect(r.latestVersion).toBe('24'); // newest LTS major
    expect(r.candidates.map((c) => c.version)).toEqual(
      expect.arrayContaining(['24', '22', '25']),
    );
  });

  it('resolveSoftwareVersionStatus apt path uses probe policy', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-vd-'));
    const host = {
      executeEnabled: () => false,
      isRoot: () => false,
      runCommand: async (argv: string[]) => {
        const s = argv.join(' ');
        if (s.includes('for p in') && s.includes('apt-cache policy')) {
          return {
            exitCode: 0,
            stdout: 'nginx\t1.18.0-1\t1.24.0-2\n',
            stderr: '',
            argv,
            dryRun: false,
          };
        }
        if (s.includes('apt-cache policy')) {
          return {
            exitCode: 0,
            stdout: 'nginx:\n  Installed: 1.18.0-1\n  Candidate: 1.24.0-2\n',
            stderr: '',
            argv,
            dryRun: false,
          };
        }
        if (s.includes('command -v')) {
          return {
            exitCode: 0,
            stdout: '/usr/sbin/nginx\n',
            stderr: '',
            argv,
            dryRun: false,
          };
        }
        return { exitCode: 0, stdout: '', stderr: '', argv, dryRun: false };
      },
    } as unknown as HostExecutor;

    const st = await resolveSoftwareVersionStatus({
      host,
      dataDir,
      id: 'nginx',
    });
    expect(st.updateKind).toBe('apt');
    expect(st.installed).toBe(true);
    expect(st.upgradable).toBe(true);
    expect(st.latestVersion).toBe('1.24.0-2');
    expect(st.currentVersion).toBe('1.18.0-1');
  });
});
