import { describe, expect, it, afterEach } from 'vitest';
import { join } from 'node:path';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { makeHost } from '../test/host.js';
import {
  installForFeature,
  installSoftware,
  installSoftwareBatch,
  probeAllSoftware,
  probeSoftware,
} from './software-install.js';
import { getSoftware } from './software-catalog.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  bins?: string[];
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  const bins = new Set(opts.bins ?? []);
  return {
    executeEnabled: () => opts.executeEnabled === true,
    isRoot: () => opts.isRoot === true,
    pathExists: (p) => p.includes('systemctl'),
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
      if (opts.run) {
        const partial = opts.run(argv);
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
          ...partial,
        };
      }
      const s = argv.join(' ');
      if (s.includes('command -v')) {
        const bin = s.match(/command -v (\S+)/)?.[1];
        if (bin && bins.has(bin)) {
          return { stdout: `/usr/bin/${bin}\n`, stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (argv[0] === 'systemctl' && argv.includes('is-active')) {
        return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('software-install honesty', () => {
  it('probeSoftware reports missing bins when not installed', async () => {
    const host = mockHost({ bins: [] });
    const nginx = getSoftware('nginx');
    expect(nginx).toBeTruthy();
    const st = await probeSoftware(host, nginx!);
    expect(st.installed).toBe(false);
    expect(st.missingBins.length).toBeGreaterThan(0);
    expect(st.id).toBe('nginx');
  });

  it('probeSoftware reports installed when any bin exists', async () => {
    const nginx = getSoftware('nginx');
    expect(nginx).toBeTruthy();
    const host = mockHost({ bins: nginx!.bins });
    const st = await probeSoftware(host, nginx!);
    expect(st.installed).toBe(true);
    expect(st.missingBins).toEqual([]);
  });

  it('probeAllSoftware returns catalog slice', async () => {
    const host = mockHost({ bins: [] });
    const all = await probeAllSoftware(host, 'all');
    expect(all.length).toBeGreaterThan(5);
    expect(all.every((s) => typeof s.installed === 'boolean')).toBe(true);
  });

  it('installSoftware unknown id fails', async () => {
    const host = mockHost({ executeEnabled: true, isRoot: true });
    const r = await installSoftware({ host, id: 'definitely-missing-pkg-xyz' });
    expect(r.ok).toBe(false);
    expect(r.executed).toBe(false);
    expect(r.steps.some((s) => s.status === 'failed')).toBe(true);
  });

  it('installSoftware blocks without execute (fail-closed)', async () => {
    const { host, dir, cleanup } = makeHost({ executeEnabled: false });
    cleanups.push(cleanup);
    const r = await installSoftware({ host, id: 'nginx', dataDir: dir });
    expect(r.ok).toBe(false);
    expect(r.executed).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe('no_execute');
    expect(r.steps.some((s) => s.status === 'blocked')).toBe(true);
    expect(r.installed).toBe(false);
  });

  it('installSoftware blocks without root when execute on', async () => {
    const host = mockHost({
      executeEnabled: true,
      isRoot: false,
      bins: [],
    });
    const r = await installSoftware({ host, id: 'nginx' });
    // if already installed on real host mock says not installed
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe('no_root');
  });

  it('installSoftware short-circuits when already installed', async () => {
    const nginx = getSoftware('nginx');
    const host = mockHost({
      executeEnabled: false,
      bins: nginx?.bins ?? ['nginx'],
    });
    const r = await installSoftware({ host, id: 'nginx' });
    expect(r.ok).toBe(true);
    expect(r.installed).toBe(true);
    expect(r.executed).toBe(false);
  });

  it('installSoftwareBatch aggregates blocked results', async () => {
    const host = mockHost({ executeEnabled: false, bins: [] });
    const batch = await installSoftwareBatch({
      host,
      ids: ['nginx', 'vsftpd'],
    });
    expect(batch.ok).toBe(false);
    expect(batch.blocked).toBe(true);
    expect(batch.results).toHaveLength(2);
    // known catalog ids → blocked (not installed) rather than unknown-id hard fail
    expect(batch.results.every((r) => r.blocked === true && r.ok === false)).toBe(true);
    expect(batch.results.every((r) => r.steps.some((s) => s.status === 'blocked'))).toBe(true);
  });

  it('installForFeature with onlyMissing reports when nothing missing', async () => {
    // mock all as installed for feature ftp if possible
    const host = mockHost({
      executeEnabled: false,
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('command -v')) {
          return { stdout: '/usr/bin/x\n', exitCode: 0 };
        }
        return {};
      },
    });
    const r = await installForFeature({
      host,
      feature: 'ftp',
      onlyMissing: true,
    });
    // either all installed → empty results, or blocked install attempts
    expect(Array.isArray(r.results)).toBe(true);
    expect(Array.isArray(r.notes)).toBe(true);
    if (!r.missingBefore.length) {
      expect(r.ok).toBe(true);
      expect(r.results).toEqual([]);
    } else {
      expect(r.blocked || !r.ok).toBe(true);
    }
  });
});
