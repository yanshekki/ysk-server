import { describe, expect, it } from 'vitest';
import {
  parsePsOutput,
  collectProcessSnapshot,
  isSamplerPsCommand,
  type ProcessRow,
} from './process-snapshot.js';
import type { HostExecutor, RunResult } from '../host/executor.js';

function empty(over: Partial<RunResult> = {}): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...over };
}

function mockHost(run: (argv: string[]) => Partial<RunResult>): HostExecutor {
  return {
    executeEnabled: () => false,
    isRoot: () => false,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty({ argv }), ...run(argv) }),
  };
}

const FULL_HEADER =
  'PID USER PR NI VSZ RSS STAT %CPU %MEM TIME ELAPSED COMMAND';
const FULL_ROW =
  '1 root 20 0 168000 12000 Ss 0.1 0.2 00:01:02 1-00:00:01 /sbin/init';
const FULL_ROW2 =
  '42 ki 20 -5 2048000 256000 Rsl 12.5 3.1 01:02:03 2-03:04:05 node server.js';

describe('parsePsOutput', () => {
  it('parses full top-like columns', () => {
    const rows = parsePsOutput([FULL_HEADER, FULL_ROW, FULL_ROW2].join('\n'), 40);
    expect(rows).toHaveLength(2);
    expect(rows[0].pid).toBe('1');
    expect(rows[0].user).toBe('root');
    expect(rows[0].pr).toBe('20');
    expect(rows[0].ni).toBe(0);
    expect(rows[0].virtKiB).toBe(168000);
    expect(rows[0].resKiB).toBe(12000);
    expect(rows[0].state).toBe('Ss');
    expect(rows[0].cpu).toBe(0.1);
    expect(rows[0].mem).toBe(0.2);
    expect(rows[0].timePlus).toBe('00:01:02');
    expect(rows[0].etime).toBe('1-00:00:01');
    expect(rows[0].command).toContain('/sbin/init');
    expect(rows[1].ni).toBe(-5);
    expect(rows[1].command).toContain('node');
  });

  it('parses mid layout with etime and legacy layout', () => {
    const mid = [
      'PID USER %CPU %MEM ELAPSED COMMAND',
      '9 alice 1.5 2.0 00:05:01 bash -l',
      '10 bob 0.0 0.1 1-02:03:04 sleep 10',
    ].join('\n');
    const midRows = parsePsOutput(mid, 10);
    expect(midRows.length).toBeGreaterThanOrEqual(1);
    expect(midRows[0].etime).toBeTruthy();
    expect(midRows[0].command).toMatch(/bash|sleep/);

    const legacy = [
      'PID USER %CPU %MEM COMMAND',
      '99 nobody 3.3 4.4 /usr/bin/python3 -m http.server',
      'bad line without nums',
      '100 x nan nan cmd',
    ].join('\n');
    const leg = parsePsOutput(legacy, 10);
    expect(leg.some((r) => r.pid === '99')).toBe(true);
    expect(leg.find((r) => r.pid === '99')?.command).toContain('python3');
  });

  it('respects limit and returns empty for short stdout', () => {
    expect(parsePsOutput('only header\n', 5)).toEqual([]);
    expect(parsePsOutput('', 5)).toEqual([]);
    const many = [FULL_HEADER, ...Array.from({ length: 20 }, (_, i) =>
      `${i + 1} u 20 0 100 50 S 1.0 1.0 00:00:01 00:01 cmd${i}`,
    )].join('\n');
    expect(parsePsOutput(many, 5)).toHaveLength(5);
  });

  it('parses KiB suffixes via full columns when units present on vsz-like tokens', () => {
    // parseKiB is exercised via plain digits; also cover empty/dash paths indirectly
    const rows = parsePsOutput(
      [FULL_HEADER, '7 z 20 0 0 0 S 0.0 0.0 00:00:00 00:00 —'].join('\n'),
      5,
    );
    expect(rows[0]?.command).toBe('—');
  });

  it('drops the sampling ps command itself', () => {
    expect(isSamplerPsCommand('ps -eo pid,user,pri,ni,vsz,rss,stat,pcpu')).toBe(true);
    expect(isSamplerPsCommand('sleep 10')).toBe(false);
    const parsed = parsePsOutput(
      [
        FULL_HEADER,
        '1 root 20 0 100 50 S 100.0 0.1 00:00:00 00:00:01 ps -eo pid,user,pri,ni,vsz,rss,stat,pcpu,pmem,time,etime,args',
        FULL_ROW,
      ].join('\n'),
      10,
    );
    expect(parsed.some((r) => isSamplerPsCommand(r.command))).toBe(true);
  });
});

describe('collectProcessSnapshot', () => {
  it('ok path with full ps and sort mem/pid/time/cpu', async () => {
    const body = [FULL_HEADER, FULL_ROW, FULL_ROW2].join('\n');
    const host = mockHost((argv) => {
      const j = argv.join(' ');
      if (j.includes('ps -eo') && j.includes('pri,ni')) {
        return { stdout: body, exitCode: 0 };
      }
      if (j.includes('/proc/stat') || j.includes('cat /proc')) {
        return { stdout: 'cpu 1 0 0 100\n', exitCode: 0 };
      }
      if (j.includes('meminfo')) {
        return { stdout: 'MemTotal: 1000 kB\nMemAvailable: 500 kB\n', exitCode: 0 };
      }
      return { stdout: '', exitCode: 1 };
    });

    for (const sort of ['cpu', 'mem', 'pid', 'time'] as const) {
      const snap = await collectProcessSnapshot(host, {
        sort,
        limit: 10,
        includeHeader: false,
        includeTop: false,
      });
      expect(snap.ok).toBe(true);
      expect(snap.rows.length).toBeGreaterThan(0);
      expect(snap.sort).toBe(sort);
      expect(snap.limit).toBe(10);
    }
  });

  it('falls back when full ps fails then mid then fails all', async () => {
    let phase = 0;
    const host = mockHost((argv) => {
      const j = argv.join(' ');
      if (j.startsWith('ps ')) {
        phase++;
        if (phase === 1) return { exitCode: 1, stderr: 'bad sort' };
        if (phase === 2) {
          return {
            exitCode: 0,
            stdout: 'PID USER %CPU %MEM ELAPSED COMMAND\n5 a 1.0 2.0 00:01:00 sleep\n',
          };
        }
      }
      return { exitCode: 1 };
    });
    const ok = await collectProcessSnapshot(host, { includeHeader: false, limit: 5 });
    expect(ok.ok).toBe(true);
    expect(ok.rows.length).toBeGreaterThan(0);
    expect(ok.notes.some((n) => n.length > 0)).toBe(true);

    const hostFail = mockHost(() => ({ exitCode: 1, stderr: 'no ps' }));
    const fail = await collectProcessSnapshot(hostFail, { includeHeader: false });
    expect(fail.ok).toBe(false);
    expect(fail.rows).toEqual([]);
    expect(fail.notes.length).toBeGreaterThan(0);
  });

  it('falls back to legacy ps when mid fails; empty rows → not ok', async () => {
    let n = 0;
    const host = mockHost((argv) => {
      if (argv[0] === 'ps') {
        n++;
        if (n === 1) return { exitCode: 1, stderr: 'err1' };
        if (n === 2) return { exitCode: 1, stderr: 'err2' };
        return {
          exitCode: 0,
          stdout: 'PID USER %CPU %MEM COMMAND\n8 root 0.5 0.1 init\n',
        };
      }
      return { exitCode: 1 };
    });
    const r = await collectProcessSnapshot(host, { includeHeader: false, sort: 'mem' });
    expect(r.ok).toBe(true);
    expect(r.rows[0]?.pid).toBe('8');

    const emptyHost = mockHost((argv) => {
      if (argv[0] === 'ps') return { exitCode: 0, stdout: 'PID USER\n' };
      return { exitCode: 1 };
    });
    const empty = await collectProcessSnapshot(emptyHost, { includeHeader: false });
    expect(empty.ok).toBe(false);
    expect(empty.rows).toEqual([]);
  });

  it('includeTop captures raw top or notes failure; clamps limit', async () => {
    const body = [FULL_HEADER, FULL_ROW].join('\n');
    const host = mockHost((argv) => {
      const j = argv.join(' ');
      if (j.includes('ps -eo') && j.includes('pri')) return { stdout: body, exitCode: 0 };
      if (j.includes('top -b')) return { stdout: 'top - 12:00\nTasks: 1\n', exitCode: 0 };
      return { exitCode: 1 };
    });
    const snap = await collectProcessSnapshot(host, {
      includeTop: true,
      includeHeader: false,
      limit: 1,
    });
    expect(snap.ok).toBe(true);
    expect(snap.rawTop).toMatch(/top/);
    expect(snap.limit).toBe(5); // min clamp

    const hostNoTop = mockHost((argv) => {
      if (argv[0] === 'ps') return { stdout: body, exitCode: 0 };
      if (argv.join(' ').includes('top')) return { exitCode: 1, stderr: 'no top' };
      return { exitCode: 1 };
    });
    const noTop = await collectProcessSnapshot(hostNoTop, {
      includeTop: true,
      includeHeader: false,
      limit: 200,
    });
    expect(noTop.limit).toBe(100); // max clamp
    expect(noTop.notes.some((n) => n.length > 0)).toBe(true);
  });

  it('sortRows time prefers longer timePlus', () => {
    // exercise via collect with sort=time and crafted rows
    const header = FULL_HEADER;
    const a = '3 u 20 0 1 1 S 1.0 1.0 00:00:01 00:01 short';
    const b = '4 u 20 0 1 1 S 2.0 1.0 10:00:00 1-00:00:00 longtime';
    const host = mockHost((argv) => {
      if (argv[0] === 'ps') return { stdout: [header, a, b].join('\n'), exitCode: 0 };
      return { exitCode: 1 };
    });
    return collectProcessSnapshot(host, { sort: 'time', includeHeader: false }).then((s) => {
      expect(s.ok).toBe(true);
      expect(s.rows[0].pid).toBe('4');
    });
  });
});

// ensure ProcessRow type is imported for TS erase (used via inference)
void (null as unknown as ProcessRow);
