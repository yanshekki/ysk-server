import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { collectTopHeader, parseTaskStates } from './top-snapshot.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(run: (argv: string[]) => Partial<RunResult> | Promise<Partial<RunResult>>): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => false,
    executeEnabled: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv, ...(await run(argv)) }),
  };
}

const STAT1 = `cpu  100 10 50 800 20 0 5 0 0 0
cpu0 50 5 25 400 10 0 2 0 0 0
cpu1 50 5 25 400 10 0 3 0 0 0
`;
const STAT2 = `cpu  200 20 100 900 30 1 10 2 0 0
cpu0 100 10 50 450 15 0 4 1 0 0
cpu1 100 10 50 450 15 1 6 1 0 0
`;
const MEM = `MemTotal:       16000000 kB
MemFree:         2000000 kB
MemAvailable:    5000000 kB
Buffers:          500000 kB
Cached:          3000000 kB
SReclaimable:     200000 kB
SwapTotal:       8000000 kB
SwapFree:        2000000 kB
`;

describe('collectTopHeader depth', () => {
  it('samples dual /proc/stat and fills memory/load/tasks', async () => {
    let statN = 0;
    const host = mockHost((argv) => {
      const j = argv.join(' ');
      if (j.includes('/proc/stat')) {
        statN += 1;
        return { stdout: statN === 1 ? STAT1 : STAT2, exitCode: 0 };
      }
      if (j.includes('/proc/meminfo')) return { stdout: MEM, exitCode: 0 };
      if (j.includes('/proc/loadavg')) return { stdout: '1.5 2.0 2.5 1/100 1\n', exitCode: 0 };
      if (j.includes('/proc/uptime')) return { stdout: '12345.67 999.0\n', exitCode: 0 };
      if (argv[0] === 'ps' && argv.includes('--no-headers')) {
        return { stdout: 'R\nS\nS\nZ\nT\n', exitCode: 0 };
      }
      return { exitCode: 1 };
    });
    const h = await collectTopHeader(host, { sampleMs: 100 });
    expect(h.ok).toBe(true);
    expect(h.cpu.busyPct).toBeGreaterThan(0);
    expect(h.cpus.length).toBe(2);
    expect(h.memory.totalKiB).toBe(16_000_000);
    expect(h.swap.usedKiB).toBe(6_000_000);
    expect(h.loadavg[0]).toBeCloseTo(1.5);
    expect(h.uptimeSec).toBeCloseTo(12345.67);
    expect(h.tasks.total).toBe(5);
    expect(h.tasks.running).toBe(1);
    expect(h.tasks.zombie).toBe(1);
    expect(h.sampleMs).toBe(100);
    expect(h.notes).toEqual([]);
  });

  it('records notes when stat/meminfo/ps all fail', async () => {
    const host = mockHost(() => ({ exitCode: 1, stderr: 'denied' }));
    const h = await collectTopHeader(host, { sampleMs: 100 });
    expect(h.ok).toBe(false);
    expect(h.notes.length).toBeGreaterThanOrEqual(2);
    expect(h.cpu.id).toBe(100);
    expect(h.memory.totalKiB).toBe(0);
  });

  it('falls back to ps without --no-headers when first fails', async () => {
    let statN = 0;
    const host = mockHost((argv) => {
      const j = argv.join(' ');
      if (j.includes('/proc/stat')) {
        statN += 1;
        return { stdout: statN === 1 ? STAT1 : STAT2, exitCode: 0 };
      }
      if (j.includes('/proc/meminfo')) return { exitCode: 1 };
      if (j.includes('/proc/loadavg')) return { exitCode: 1 };
      if (j.includes('/proc/uptime')) return { exitCode: 1 };
      if (argv[0] === 'ps' && argv.includes('--no-headers')) {
        return { exitCode: 1, stderr: 'bad opt' };
      }
      if (argv[0] === 'ps') {
        return { stdout: 'STAT\nR\nSs\nI\n', exitCode: 0 };
      }
      return { exitCode: 1 };
    });
    const h = await collectTopHeader(host, { sampleMs: 100 });
    expect(h.ok).toBe(true);
    expect(h.tasks.total).toBeGreaterThanOrEqual(2);
    expect(h.notes.some((n) => n.length > 0)).toBe(true); // meminfo fail note
  });

  it('clamps sampleMs and handles partial stat (only total)', async () => {
    let n = 0;
    const host = mockHost((argv) => {
      const j = argv.join(' ');
      if (j.includes('/proc/stat')) {
        n += 1;
        // second sample missing total → notes path
        return {
          stdout: n === 1 ? 'cpu  1 0 0 1 0 0 0 0 0 0\n' : 'intr 1\n',
          exitCode: 0,
        };
      }
      if (j.includes('/proc/meminfo')) return { stdout: 'MemTotal: 1000 kB\nMemFree: 500 kB\n', exitCode: 0 };
      if (argv[0] === 'ps') return { stdout: '', exitCode: 0 };
      return { exitCode: 0, stdout: '0.0 0.0 0.0 1/1 1\n' };
    });
    const h = await collectTopHeader(host, { sampleMs: 50 }); // clamped to 100
    expect(h.sampleMs).toBe(100);
    expect(h.memory.totalKiB).toBe(1000);
    expect(h.ok).toBe(true);
  });

  it('parseTaskStates skips long lines and non-letter states', () => {
    const t = parseTaskStates('STAT\nR\ntoolongstate\n?\n  \nSs\n');
    expect(t.running).toBe(1);
    expect(t.sleeping).toBe(1);
    expect(t.total).toBe(2);
  });
});
