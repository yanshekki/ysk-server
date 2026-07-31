import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  collectMetrics,
  parseDfOutput,
  collectDiskMounts,
  collectMetricsDeep,
} from './metrics.js';

function mockHost(
  run: (argv: string[]) => Partial<RunResult> | Promise<Partial<RunResult>>,
): HostExecutor {
  return {
    runCommand: async (argv) => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv,
      dryRun: false,
      ...(await run(argv)),
    }),
    executeEnabled: () => false,
    isRoot: () => false,
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

describe('metrics depth', () => {
  it('parseDfOutput skips pseudo and short lines; includePseudo keeps tmpfs', () => {
    const sample = `
Filesystem     1B-blocks        Used   Available Capacity Mounted on
/dev/sda1     1000000000   900000001   99999999      91% /
tmpfs            1000000           0    1000000       0% /dev/shm
overlay         20000000     1000000   19000000       5% /var/lib/docker
/dev/sdb1      500000000   100000000  400000000      20% /data with spaces
badline
`.trim();
    const normal = parseDfOutput(sample);
    expect(normal.some((m) => m.mount === '/')).toBe(true);
    expect(normal.some((m) => m.mount.includes('/data'))).toBe(true);
    expect(normal.some((m) => m.mount === '/dev/shm')).toBe(false);
    expect(normal.some((m) => m.filesystem === 'overlay')).toBe(false);

    const withPseudo = parseDfOutput(sample, { includePseudo: true });
    expect(withPseudo.some((m) => m.mount === '/dev/shm')).toBe(true);

    expect(parseDfOutput('Filesystem\n')).toHaveLength(0);
    expect(parseDfOutput('')).toHaveLength(0);
  });

  it('collectDiskMounts handles df failure and empty parse', async () => {
    const fail = await collectDiskMounts(
      mockHost(async () => ({ exitCode: 1, stderr: 'df broken' })),
    );
    expect(fail.mounts).toHaveLength(0);
    expect(fail.notes.length).toBeGreaterThan(0);

    const empty = await collectDiskMounts(
      mockHost(async () => ({
        exitCode: 0,
        stdout: 'Filesystem 1B-blocks Used Available Capacity Mounted on\n',
      })),
    );
    expect(empty.mounts).toHaveLength(0);
    expect(empty.notes.length).toBeGreaterThan(0);
  });

  it('collectDiskMounts parses real-shaped df output', async () => {
    const stdout = `
Filesystem     1B-blocks        Used   Available Capacity Mounted on
/dev/sda1     2000000000  1900000000   100000000      95% /
/dev/sdb1      500000000   100000000   400000000      20% /data
`.trim();
    const r = await collectDiskMounts(
      mockHost(async () => ({ exitCode: 0, stdout })),
    );
    expect(r.mounts.length).toBe(2);
    expect(r.mounts.find((m) => m.mount === '/')!.usedRatio).toBeGreaterThan(0.9);
  });

  it('collectMetricsDeep merges mounts and disk_high alert', async () => {
    const stdout = `
Filesystem     1B-blocks        Used   Available Capacity Mounted on
/dev/sda1     1000000000   950000000    50000000      95% /
`.trim();
    const deep = await collectMetricsDeep(
      mockHost(async () => ({ exitCode: 0, stdout })),
    );
    expect(deep.diskMounts?.length).toBe(1);
    expect(deep.disk?.path).toBe('/');
    expect(deep.alerts).toContain('disk_high');
    expect(deep.cpuCount).toBeGreaterThan(0);
  });

  it('collectMetrics basic shape', () => {
    const m = collectMetrics('/');
    expect(m.memory.total).toBeGreaterThan(0);
    expect(m.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(m.alerts)).toBe(true);
  });
});
