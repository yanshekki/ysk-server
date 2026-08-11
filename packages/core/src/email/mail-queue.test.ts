import { describe, expect, it } from 'vitest';
import { listMailQueue, flushMailQueue } from './mail-queue.js';
import type { HostExecutor, RunResult } from '../host/executor.js';

function host(exec: boolean, run: (argv: string[]) => RunResult): HostExecutor {
  return {
    executeEnabled: () => exec,
    isRoot: () => true,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) => run(argv),
  };
}

describe('mail-queue', () => {
  it('blocks without EXECUTE', async () => {
    const h = host(false, () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }));
    const r = await listMailQueue(h);
    expect(r.blocked).toBe(true);
    expect(r.requiresExecute).toBe(true);
    const f = await flushMailQueue(h, { all: true });
    expect(f.blocked).toBe(true);
  });

  it('parses queue and flushes', async () => {
    const h = host(true, (argv) => {
      const s = argv.join(' ');
      if (s.includes('command -v') && s.includes('postqueue') && !s.includes('postqueue -p')) {
        return {
          stdout: '/usr/sbin/postqueue\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      // Full list script contains postqueue -p
      if (s.includes('postqueue -p') || (s.includes('postqueue') && s.includes('then'))) {
        return {
          stdout: 'ABC123  (queue active)\n  from@x\nDEF456  (queue active)\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('postsuper')) {
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: 'NO_POSTQUEUE', stderr: '', exitCode: 1, argv, dryRun: false };
    });
    const list = await listMailQueue(h);
    expect(list.ok).toBe(true);
    expect(list.items.length).toBe(2);
    const fl = await flushMailQueue(h, { id: 'ABC123' });
    expect(fl.ok).toBe(true);
    expect(fl.flushed).toBe(1);
    const all = await flushMailQueue(h, { all: true });
    expect(all.ok).toBe(true);
  });

  it('heals when mail system is down then lists empty queue', async () => {
    let started = false;
    const h: HostExecutor = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: (p) =>
        p.includes('postfix') || p.includes('postqueue') || p.includes('/var/spool'),
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
        const s = argv.join(' ');
        if (s.includes('command -v') && s.includes('postqueue') && !s.includes('postqueue -p')) {
          return {
            stdout: '/usr/sbin/postqueue\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('postqueue -p') || (s.includes('postqueue') && s.includes('then'))) {
          if (!started) {
            return {
              stdout:
                'postqueue: warning: Mail system is down -- accessing queue directly (Connect to the Postfix showq service: No such file or directory)\npostqueue: fatal: malformed showq server response\n',
              stderr: '',
              exitCode: 1,
              argv,
              dryRun: false,
            };
          }
          return {
            stdout: 'Mail queue is empty\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (
          s.includes('systemctl') ||
          s.includes('postfix start') ||
          s.includes('is-active') ||
          s.includes('mkdir') ||
          s.includes('postfix check') ||
          s.includes('set-permissions')
        ) {
          started = true;
          return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('setgid_group') || s.includes('queue_directory')) {
          return { stdout: 'postdrop\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    const r = await listMailQueue(h);
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(0);
  });

  it('repairs empty setgid_group then lists queue', async () => {
    let fixed = false;
    const h = host(true, (argv) => {
      const s = argv.join(' ');
      if (s.includes('command -v')) {
        return {
          stdout: '/usr/sbin/postqueue\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('postconf -h setgid_group')) {
        return {
          stdout: fixed ? 'postdrop\n' : '\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('postconf -e') && s.includes('setgid_group')) {
        fixed = true;
        return { stdout: 'postdrop\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (s.includes('postqueue -p') || (s.includes('postqueue') && s.includes('then'))) {
        if (!fixed) {
          return {
            stdout: '',
            stderr: 'postqueue: fatal: bad string length 0 < 1: setgid_group =',
            exitCode: 1,
            argv,
            dryRun: false,
          };
        }
        return {
          stdout: 'Mail queue is empty\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    });
    const r = await listMailQueue(h);
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(0);
  });

  it('handles empty and missing postqueue', async () => {
    const empty = host(true, (argv) => {
      const s = argv.join(' ');
      if (s.includes('command -v')) {
        return { stdout: '/usr/sbin/postqueue\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return {
        stdout: 'Mail queue is empty',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
      };
    });
    const e = await listMailQueue(empty);
    expect(e.ok).toBe(true);
    expect(e.items).toHaveLength(0);

    const missing = host(true, (argv) => {
      const s = argv.join(' ');
      if (s.includes('command -v')) {
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return {
        stdout: 'NO_POSTQUEUE',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
      };
    });
    const m = await listMailQueue(missing);
    expect(m.ok).toBe(false);
  });
});
