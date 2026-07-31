import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  normalizePid,
  signalProcess,
  reniceProcess,
  collectProcessDetail,
  readProcessCmdline,
  isProcessSignal,
} from './process-signal.js';

function mockHost(opts: {
  executeEnabled?: boolean;
  run?: (argv: string[]) => Promise<Partial<RunResult>> | Partial<RunResult>;
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

describe('process-signal depth', () => {
  it('normalizePid rejects zero and non-safe', () => {
    expect(normalizePid('0').ok).toBe(false);
    expect(normalizePid('').ok).toBe(false);
    expect(normalizePid(2.5).ok).toBe(false);
  });

  it('invalid signal string fails', async () => {
    const r = await signalProcess({
      host: mockHost({ executeEnabled: true }),
      pid: '99',
      signal: 'TERM',
    });
    // valid path still needs further checks
    expect(isProcessSignal('HUP')).toBe(true);
    expect(isProcessSignal('USR1')).toBe(true);
    void r;
    const bad = await signalProcess({
      host: mockHost({ executeEnabled: true }),
      pid: '99',
      // force invalid via cast
      signal: 'INT' as never,
    });
    expect(bad.ok).toBe(false);
  });

  it('process gone on kill -0 is honest failure', async () => {
    const r = await signalProcess({
      host: mockHost({
        executeEnabled: true,
        run: async (argv) => {
          if (argv[0] === 'bash') return { stdout: 'worker' };
          if (argv[0] === 'kill' && argv[1] === '-0') {
            return { exitCode: 1, stderr: 'No such process' };
          }
          return {};
        },
      }),
      pid: '55555',
      signal: 'TERM',
    });
    expect(r.ok).toBe(false);
    expect(r.stillAlive).toBe(false);
  });

  it('kill command failure reports stillAlive', async () => {
    const r = await signalProcess({
      host: mockHost({
        executeEnabled: true,
        run: async (argv) => {
          if (argv[0] === 'bash') return { stdout: 'worker' };
          if (argv[0] === 'kill' && argv[1] === '-0') return { exitCode: 0 };
          if (argv[0] === 'kill' && argv[1] === '-s') {
            return { exitCode: 1, stderr: 'Operation not permitted' };
          }
          return {};
        },
      }),
      pid: '66666',
      signal: 'USR1',
    });
    expect(r.ok).toBe(false);
    expect(r.stillAlive).toBe(true);
  });

  it('forceControlPlane allows signaling ysk-looking cmdline', async () => {
    let kill0 = 0;
    const r = await signalProcess({
      host: mockHost({
        executeEnabled: true,
        run: async (argv) => {
          if (argv[0] === 'bash') return { stdout: 'node /opt/ysk-server/dist/cli.js' };
          if (argv[0] === 'kill' && argv[1] === '-0') {
            kill0 += 1;
            return { exitCode: kill0 === 1 ? 0 : 1 };
          }
          if (argv[0] === 'kill' && argv[1] === '-s') return { exitCode: 0 };
          return {};
        },
      }),
      pid: '77777',
      signal: 'HUP',
      forceControlPlane: true,
    });
    expect(r.ok).toBe(true);
  });

  it('renice validates range and blocks without execute / self', async () => {
    const noPid = await reniceProcess({
      host: mockHost({ executeEnabled: true }),
      pid: 'nope',
      nice: 5,
    });
    expect(noPid.ok).toBe(false);

    const badNice = await reniceProcess({
      host: mockHost({ executeEnabled: true }),
      pid: '1234',
      nice: 50,
    });
    expect(badNice.ok).toBe(false);

    const self = await reniceProcess({
      host: mockHost({ executeEnabled: true }),
      pid: process.pid,
      nice: 5,
    });
    expect(self.ok).toBe(false);
    expect(self.blocked).toBe(true);

    const noExec = await reniceProcess({
      host: mockHost({ executeEnabled: false }),
      pid: '1234',
      nice: 5,
    });
    expect(noExec.ok).toBe(false);
    expect(noExec.blocked).toBe(true);

    const fail = await reniceProcess({
      host: mockHost({
        executeEnabled: true,
        run: async () => ({ exitCode: 1, stderr: 'perm denied' }),
      }),
      pid: '1234',
      nice: 10,
    });
    expect(fail.ok).toBe(false);

    const ok = await reniceProcess({
      host: mockHost({
        executeEnabled: true,
        run: async (argv) => {
          if (argv[0] === 'renice') return { exitCode: 0 };
          if (argv[0] === 'ps') return { exitCode: 0, stdout: '  10\n' };
          return {};
        },
      }),
      pid: '1234',
      nice: 10,
    });
    expect(ok.ok).toBe(true);
    expect(ok.nice).toBe(10);
  });

  it('collectProcessDetail and readProcessCmdline', async () => {
    const bad = await collectProcessDetail(mockHost({}), '1');
    expect(bad.ok).toBe(false);

    const host = mockHost({
      run: async (argv) => {
        const j = argv.join(' ');
        if (j.includes('cmdline')) return { exitCode: 0, stdout: 'sleep 999' };
        if (j.includes('cwd')) return { exitCode: 0, stdout: '/tmp' };
        if (j.includes('fd')) return { exitCode: 0, stdout: '12\n' };
        return {};
      },
    });
    const d = await collectProcessDetail(host, '4242');
    expect(d.ok).toBe(true);
    expect(d.command).toContain('sleep');
    expect(d.cwd).toBe('/tmp');
    expect(d.fdCount).toBe(12);

    const cmd = await readProcessCmdline(
      mockHost({
        run: async () => ({ exitCode: 1 }),
      }),
      '9',
    );
    expect(cmd).toBeUndefined();
  });

  it('stillAlive note after KILL when process remains', async () => {
    const r = await signalProcess({
      host: mockHost({
        executeEnabled: true,
        run: async (argv) => {
          if (argv[0] === 'bash') return { stdout: 'immortal' };
          if (argv[0] === 'kill') return { exitCode: 0 };
          return {};
        },
      }),
      pid: '8888',
      signal: 'KILL',
    });
    expect(r.ok).toBe(true);
    expect(r.stillAlive).toBe(true);
  });
});
