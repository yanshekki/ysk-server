import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  clampLines,
  journalDiskUsage,
  listJournalUnits,
  queryJournal,
  sanitizeGrep,
  sanitizePriority,
  sanitizeSince,
  sanitizeUnit,
  vacuumJournal,
} from './journal.js';

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.executeEnabled === true,
    isRoot: () => opts.isRoot === true,
    pathExists: () => false,
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

describe('journal sanitize + query', () => {
  it('sanitizes unit, priority, since, grep, lines', () => {
    expect(sanitizeUnit('nginx.service')).toBe('nginx.service');
    expect(sanitizeUnit('../evil')).toBeNull();
    expect(sanitizeUnit('a/b')).toBeNull();
    expect(sanitizeUnit('')).toBeNull();
    expect(sanitizePriority('err')).toBe('err');
    expect(sanitizePriority('nope')).toBeUndefined();
    expect(sanitizeSince('1h')).toBe('1 hour ago');
    expect(sanitizeSince('2024-01-02')).toBe('2024-01-02');
    expect(sanitizeSince('rm -rf /')).toBeUndefined();
    expect(sanitizeGrep('error')).toBe('error');
    expect(sanitizeGrep('x'.repeat(300))?.length).toBe(200);
    expect(sanitizeGrep('a\0b')).toBeUndefined();
    expect(clampLines(10)).toBe(50);
    expect(clampLines(99999)).toBe(5000);
    expect(clampLines(undefined)).toBe(300);
  });

  it('listJournalUnits parses plain output and falls back on error', async () => {
    const ok = await listJournalUnits(
      mockHost({
        run: (argv) => {
          if (argv[0] === 'systemctl') {
            return {
              exitCode: 0,
              stdout:
                'nginx.service loaded active running Nginx\nssh.service loaded active running OpenSSH\n',
            };
          }
          return {};
        },
      }),
    );
    expect(ok.items.some((i) => i.unit === 'nginx.service')).toBe(true);
    expect(ok.items.some((i) => i.unit === 'ssh.service')).toBe(true);

    const fallback = await listJournalUnits(
      mockHost({
        run: () => ({ exitCode: 1, stderr: 'permission denied' }),
      }),
    );
    expect(fallback.items.length).toBeGreaterThan(0);
    expect(fallback.items.some((i) => i.unit.endsWith('.service'))).toBe(true);
    expect(fallback.notes.length).toBeGreaterThan(0);
  });

  it('queryJournal rejects bad unit and returns lines on success', async () => {
    const bad = await queryJournal(mockHost({}), { unit: '../x' });
    expect(bad.ok).toBe(false);
    expect(bad.lines).toEqual([]);

    const host = mockHost({
      run: (argv) => {
        if (argv[0] === 'journalctl') {
          expect(argv).toContain('-u');
          expect(argv).toContain('nginx.service');
          expect(argv).toContain('--since');
          expect(argv).toContain('-p');
          return {
            exitCode: 0,
            stdout: '2024-01-01T00:00:00 nginx start\nline2 password=secret\n',
          };
        }
        return {};
      },
    });
    const q = await queryJournal(host, {
      unit: 'nginx.service',
      lines: 100,
      since: '1h',
      priority: 'err',
      grep: 'start',
    });
    expect(q.ok).toBe(true);
    expect(q.lineCount).toBeGreaterThan(0);
    expect(q.source).toBe('journal:nginx.service');
  });

  it('queryJournal marks requiresRoot on permission failure', async () => {
    const q2 = await queryJournal(
      mockHost({
        isRoot: false,
        run: () => ({
          exitCode: 1,
          stderr: 'Permission denied',
          stdout: '',
        }),
      }),
      { unit: 'nginx.service' },
    );
    // stderr is folded into lines when exit != 0, so ok may be true if any text returned
    expect(q2.requiresRoot).toBe(true);
    expect(q2.notes.some((n) => n.length > 0)).toBe(true);
    // blocked only when zero lines after parse
    if (q2.lineCount === 0) {
      expect(q2.blocked).toBe(true);
      expect(q2.ok).toBe(false);
    }
  });

  it('journalDiskUsage returns trimmed string or undefined', async () => {
    const ok = await journalDiskUsage(
      mockHost({
        run: () => ({
          exitCode: 0,
          stdout: 'Archived and active journals take up 1.5G in the file system.\n',
        }),
      }),
    );
    expect(ok).toContain('1.5G');
    const miss = await journalDiskUsage(
      mockHost({ run: () => ({ exitCode: 1, stderr: 'fail' }) }),
    );
    expect(miss).toBeUndefined();
  });

  it('vacuumJournal fail-closed without execute or root; validates value', async () => {
    const noExec = await vacuumJournal(
      mockHost({ executeEnabled: false, isRoot: true }),
      'time',
      '7d',
    );
    expect(noExec.ok).toBe(false);
    expect(noExec.blocked).toBe(true);
    expect(noExec.requiresExecute).toBe(true);

    const noRoot = await vacuumJournal(
      mockHost({ executeEnabled: true, isRoot: false }),
      'size',
      '100M',
    );
    expect(noRoot.ok).toBe(false);
    expect(noRoot.blocked).toBe(true);
    expect(noRoot.requiresRoot).toBe(true);

    const badVal = await vacuumJournal(
      mockHost({ executeEnabled: true, isRoot: true }),
      'time',
      'drop table',
    );
    expect(badVal.ok).toBe(false);

    const calls: string[][] = [];
    const ok = await vacuumJournal(
      mockHost({
        executeEnabled: true,
        isRoot: true,
        run: (argv) => {
          calls.push(argv);
          return { exitCode: 0, stdout: 'Vacuuming done' };
        },
      }),
      'time',
      '7d',
    );
    expect(ok.ok).toBe(true);
    expect(ok.applied).toBe(true);
    expect(calls[0]?.[0]).toBe('journalctl');
    expect(calls[0]?.some((a) => a.includes('--vacuum-time='))).toBe(true);
  });
});
