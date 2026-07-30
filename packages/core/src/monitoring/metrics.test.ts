import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectMetrics, parseDfOutput } from './metrics.js';
import { parsePsOutput } from './process-snapshot.js';
import { collectProjectsDiskUsage } from './project-usage.js';
import type { HostExecutor } from '../host/executor.js';

describe('collectMetrics', () => {
  it('returns load and memory snapshot', () => {
    const m = collectMetrics();
    expect(m.cpuCount).toBeGreaterThan(0);
    expect(m.memory.total).toBeGreaterThan(0);
    expect(m.loadavg).toHaveLength(3);
    expect(m.at).toBeTruthy();
  });
});

describe('parseDfOutput', () => {
  it('parses df -P -B1 lines and skips tmpfs', () => {
    const sample = `
Filesystem     1024-blocks        Used   Available Capacity Mounted on
/dev/sda1     2000000000000  800000000000 1100000000000      42% /
tmpfs            8000000000            0    8000000000       0% /dev/shm
/dev/sdb1      500000000000  100000000000  400000000000      20% /data
`.trim();
    const mounts = parseDfOutput(sample);
    expect(mounts.some((m) => m.mount === '/')).toBe(true);
    expect(mounts.some((m) => m.mount === '/data')).toBe(true);
    expect(mounts.some((m) => m.mount === '/dev/shm')).toBe(false);
    const root = mounts.find((m) => m.mount === '/')!;
    expect(root.usedRatio).toBeGreaterThan(0.3);
    expect(root.usedRatio).toBeLessThan(0.5);
  });
});

describe('parsePsOutput', () => {
  it('parses ps rows', () => {
    const sample = `
  PID USER         %CPU %MEM COMMAND
    1 root          0.1  0.2 /sbin/init
  42 www-data      12.5  3.1 nginx: worker
  99 ki            45.0  8.2 /usr/bin/node server.js
`.trim();
    const rows = parsePsOutput(sample, 10);
    expect(rows.length).toBe(3);
    expect(rows[2].pid).toBe('99');
    expect(rows[2].cpu).toBe(45);
    expect(rows[2].command).toContain('node');
  });

  it('parses etime column when present', () => {
    const sample = `
  PID USER         %CPU %MEM     ELAPSED COMMAND
  42 www-data      12.5  3.1       01:02 nginx: worker
  99 ki            45.0  8.2  2-03:04:05 /usr/bin/node server.js
`.trim();
    const rows = parsePsOutput(sample, 10);
    expect(rows.length).toBe(2);
    expect(rows[0].etime).toBe('01:02');
    expect(rows[1].etime).toBe('2-03:04:05');
    expect(rows[1].command).toContain('node');
  });

  it('parses full top-like columns', () => {
    const sample2 = `
  PID USER     PRI  NI    VSZ   RSS STAT %CPU %MEM     TIME     ELAPSED COMMAND
69712 ki        19   0 911956 130144 Rsl 24.0  0.8 02:51:46    11:54:18 /usr/libexec/gnome-terminal-server
`.trim();
    const rows = parsePsOutput(sample2, 5);
    expect(rows.length).toBe(1);
    expect(rows[0].state).toBe('Rsl');
    expect(rows[0].resKiB).toBe(130144);
    expect(rows[0].timePlus).toBe('02:51:46');
    expect(rows[0].etime).toBe('11:54:18');
    expect(rows[0].command).toContain('gnome-terminal');
  });
});

describe('collectProjectsDiskUsage', () => {
  it('measures real dirs and sorts by used desc', async () => {
    const a = mkdtempSync(join(tmpdir(), 'ysk-pu-a-'));
    const b = mkdtempSync(join(tmpdir(), 'ysk-pu-b-'));
    try {
      writeFileSync(join(a, 'big.txt'), 'x'.repeat(4096));
      writeFileSync(join(b, 'small.txt'), 'y');
      const host = {
        executeEnabled: () => false,
        isRoot: () => false,
        pathExists: () => true,
        readFile: async () => '',
        listDir: async () => [],
        writeFile: async () => undefined,
        deletePath: async () => undefined,
        mkdirp: async () => undefined,
        sysInfo: async () => ({}),
        serviceStatus: async () => ({
          stdout: '',
          stderr: '',
          exitCode: 0,
          argv: [],
          dryRun: false,
        }),
        runCommand: async (argv: string[]) => {
          // Delegate to real du via child_process for honesty in test
          const { spawnSync } = await import('node:child_process');
          const r = spawnSync(argv[0]!, argv.slice(1), { encoding: 'utf8' });
          return {
            stdout: r.stdout ?? '',
            stderr: r.stderr ?? '',
            exitCode: r.status ?? 1,
            argv,
            dryRun: false,
          };
        },
      } as unknown as HostExecutor;

      const snap = await collectProjectsDiskUsage({
        host,
        projects: [
          { id: 'p-small', name: 'small', home_dir: b, quota_mb: 10 },
          { id: 'p-big', name: 'big', home_dir: a, quota_mb: 1 },
        ],
      });
      expect(snap.ok).toBe(true);
      expect(snap.items).toHaveLength(2);
      expect(snap.items[0]!.projectId).toBe('p-big');
      expect(snap.items[0]!.usedBytes).toBeGreaterThan(snap.items[1]!.usedBytes);
      expect(snap.totalUsedBytes).toBeGreaterThan(0);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});
