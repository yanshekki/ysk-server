import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  normalizePid,
  isProcessSignal,
  signalProcess,
} from './process-signal.js';

function mockHost(opts: {
  executeEnabled?: boolean;
  run?: (argv: string[]) => Promise<Partial<RunResult>>;
}): HostExecutor {
  return {
    runCommand: async (argv: string[]) => {
      const partial = opts.run ? await opts.run(argv) : {};
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
        ...partial,
      };
    },
    executeEnabled: () => opts.executeEnabled !== false,
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

describe('normalizePid', () => {
  it('rejects non-numeric and PID 1', () => {
    expect(normalizePid('abc').ok).toBe(false);
    expect(normalizePid('1').ok).toBe(false);
    expect(normalizePid(1).ok).toBe(false);
    expect(normalizePid('-5').ok).toBe(false);
  });

  it('accepts normal PIDs', () => {
    const r = normalizePid('4242');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pid).toBe('4242');
  });
});

describe('isProcessSignal', () => {
  it('whitelists signals', () => {
    expect(isProcessSignal('TERM')).toBe(true);
    expect(isProcessSignal('KILL')).toBe(true);
    expect(isProcessSignal('SIGTERM')).toBe(false);
    expect(isProcessSignal('9')).toBe(false);
  });
});

describe('signalProcess', () => {
  it('blocks without YSK_EXECUTE', async () => {
    const host = mockHost({
      executeEnabled: false,
      run: async (argv) => {
        if (argv[0] === 'bash') return { stdout: 'sleep 999' };
        return {};
      },
    });
    const r = await signalProcess({ host, pid: '99999', signal: 'TERM' });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.blockMessage).toMatch(/YSK_EXECUTE|系統變更權限/);
  });

  it('refuses PID 1', async () => {
    const host = mockHost({ executeEnabled: true });
    const r = await signalProcess({ host, pid: '1', signal: 'KILL' });
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toMatch(/PID 1|init/);
  });

  it('refuses self PID without forceSelf', async () => {
    const host = mockHost({ executeEnabled: true });
    const r = await signalProcess({
      host,
      pid: String(process.pid),
      signal: 'TERM',
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('kills and reports stillAlive false when gone', async () => {
    const calls: string[][] = [];
    let kill0Count = 0;
    const host = mockHost({
      executeEnabled: true,
      run: async (argv) => {
        calls.push(argv);
        if (argv[0] === 'bash') return { stdout: 'fake-worker' };
        if (argv[0] === 'kill' && argv[1] === '-0') {
          kill0Count += 1;
          // first probe: alive; after signal: dead
          return { exitCode: kill0Count === 1 ? 0 : 1, stderr: kill0Count === 1 ? '' : 'No such process' };
        }
        if (argv[0] === 'kill' && argv[1] === '-s') {
          return { exitCode: 0 };
        }
        return {};
      },
    });
    const r = await signalProcess({ host, pid: '424242', signal: 'KILL' });
    expect(r.ok).toBe(true);
    expect(r.stillAlive).toBe(false);
    expect(calls.some((a) => a[0] === 'kill' && a[1] === '-s' && a[2] === 'SIGKILL')).toBe(
      true,
    );
  });

  it('reports stillAlive after TERM when process remains', async () => {
    const host = mockHost({
      executeEnabled: true,
      run: async (argv) => {
        if (argv[0] === 'bash') return { stdout: 'stub' };
        if (argv[0] === 'kill') return { exitCode: 0 };
        return {};
      },
    });
    const r = await signalProcess({ host, pid: '777', signal: 'TERM' });
    expect(r.ok).toBe(true);
    expect(r.stillAlive).toBe(true);
    expect(r.notes.some((n) => /仍在|KILL/.test(n))).toBe(true);
  });

  it('blocks control-plane-looking command', async () => {
    const host = mockHost({
      executeEnabled: true,
      run: async (argv) => {
        if (argv[0] === 'bash') {
          return { stdout: 'node /opt/ysk-server/apps/server/dist/cli.js' };
        }
        return {};
      },
    });
    const r = await signalProcess({ host, pid: '88888', signal: 'KILL' });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.blockMessage).toMatch(/控制面/);
  });
});
