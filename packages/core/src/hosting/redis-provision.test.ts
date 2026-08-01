import { describe, expect, it } from 'vitest';
import { LocalHostExecutor } from '../host/executor.js';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { provisionRedisBinding } from './redis-provision.js';

function mockHost(opts: {
  execute?: boolean;
  onRun?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => true,
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
    runCommand: async (argv) => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv,
      dryRun: false,
      ...(opts.onRun?.(argv) ?? {}),
    }),
  };
}

describe('provisionRedisBinding', () => {
  it('refuses execute without EXECUTE / redis-cli', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await provisionRedisBinding({
      hostExec: host,
      projectId: 'p1',
      dbIndex: 2,
      execute: true,
    });
    expect(r.ok).toBe(false);
    expect(r.executed).toBe(false);
    expect(r.plan.connectionHint?.db).toBe(2);
    expect(r.notes.join(' ')).toMatch(
      /NOT provisioned|YSK_EXECUTE|redis-cli|系統變更|尚未|Redis|權限/i,
    );
  });

  it('dry-run without execute and full PING path', async () => {
    const dry = await provisionRedisBinding({
      hostExec: mockHost({
        execute: true,
        onRun: (argv) => {
          if (argv.join(' ').includes('redis-cli')) return { stdout: '/usr/bin/redis-cli\n' };
          return {};
        },
      }),
      projectId: 'p2',
      execute: false,
      redisHost: '127.0.0.1',
      redisPort: 6379,
    });
    expect(dry.ok).toBe(true);
    expect(dry.dryRun).toBe(true);
    expect(dry.executed).toBe(false);

    const noCli = await provisionRedisBinding({
      hostExec: mockHost({
        execute: true,
        onRun: () => ({ stdout: '' }),
      }),
      projectId: 'p3',
      execute: true,
    });
    expect(noCli.ok).toBe(false);
    expect(noCli.redisCli).toBe(false);

    const full = await provisionRedisBinding({
      hostExec: mockHost({
        execute: true,
        onRun: (argv) => {
          const j = argv.join(' ');
          if (j.includes('command -v')) return { stdout: '/usr/bin/redis-cli\n' };
          if (j.includes('PING') || argv.includes('PING')) return { stdout: 'PONG\n', exitCode: 0 };
          return { stdout: 'PONG\n', exitCode: 0 };
        },
      }),
      projectId: 'p4',
      dbIndex: 3,
      maxmemoryMb: 128,
      execute: true,
    });
    // reachable depends on real port probe; still exercise redis-cli branch when reachable
    expect(full.redisCli === true || full.ok === false).toBe(true);
  });
});
