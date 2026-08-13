import { describe, expect, it } from 'vitest';
import { listMailQueue, flushMailQueue, parsePostqueueOutput } from './mail-queue.js';
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
  it('lists without EXECUTE; flush still blocked', async () => {
    const h = host(false, (argv) => {
      const s = argv.join(' ');
      if (s.includes('command -v') && s.includes('postqueue') && !s.includes('postqueue -p')) {
        return { stdout: '/usr/sbin/postqueue\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (s.includes('postqueue -p') || (s.includes('postqueue') && s.includes('then'))) {
        return { stdout: 'Mail queue is empty\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    });
    const r = await listMailQueue(h);
    expect(r.blocked).not.toBe(true);
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(0);
    const f = await flushMailQueue(h, { all: true });
    expect(f.blocked).toBe(true);
  });

  it('parses postqueue -p sender, size, recipients, reason', () => {
    const items = parsePostqueueOutput(`
-Queue ID-  --Size-- ----Arrival Time---- -Sender/Recipient-------
4F3A2B1C3D*    2345 Tue Aug 13 12:00:01  alice@example.com
(connect to mx.example.com[1.2.3.4]:25: Connection refused)
                                         bob@dest.com
4F3A2B1C3E     8901 Tue Aug 13 12:01:00  carol@example.com
                                         dave@dest.com

-- 10 Kbytes in 2 Requests.
`);
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe('4F3A2B1C3D');
    expect(items[0]?.size).toBe(2345);
    expect(items[0]?.sender).toBe('alice@example.com');
    expect(items[0]?.status).toBe('active');
    expect(items[0]?.recipients).toEqual(['bob@dest.com']);
    expect(items[0]?.reason).toMatch(/Connection refused/);
    expect(items[1]?.sender).toBe('carol@example.com');
    expect(items[1]?.status).toBe('deferred');
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
