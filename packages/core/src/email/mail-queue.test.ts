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
      // Full list script contains both shell probe and postqueue -p
      if (s.includes('postqueue -p') || (s.includes('postqueue') && s.includes('then'))) {
        return {
          stdout: 'ABC123  (queue active)\n  from@x\nDEF456  (queue active)\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('command -v')) {
        return {
          stdout: s.includes('postqueue') ? '/usr/sbin/postqueue\n' : '',
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
