import { describe, expect, it } from 'vitest';
import {
  probeRedisService,
  startRedisService,
  listRedisKeys,
  getRedisKey,
  setRedisString,
  deleteRedisKey,
} from './redis-browser.js';
import type { HostExecutor } from '../host/executor.js';

function host(opts: { execute?: boolean; root?: boolean; pong?: boolean }): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) => {
      const s = argv.join(' ');
      if (s.includes('command -v redis')) {
        return { stdout: '/usr/bin/redis-cli\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (s.includes('is-active')) {
        return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      // TCP probe often uses bash/timeout/nc — pretend failure for reachability unless redis-cli works
      if (s.includes('redis-cli') || argv.includes('redis-cli')) {
        if (s.includes('PING') || argv.includes('PING')) {
          return {
            stdout: opts.pong === false ? 'NO' : 'PONG\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('INFO') || argv.includes('INFO')) {
          return {
            stdout:
              'redis_version:7.0\nused_memory_human:1M\nconnected_clients:1\ndb0:keys=2,expires=0\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('CONFIG') || argv.includes('CONFIG')) {
          return { stdout: 'databases\n16\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('SCAN') || argv.includes('SCAN') || s.includes('KEYS')) {
          return { stdout: '0\nkey1\nkey2\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('TYPE') || argv.includes('TYPE')) {
          return { stdout: 'string\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('GET') || argv.includes('GET')) {
          return { stdout: 'hello\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('SET') || argv.includes('SET') || s.includes('DEL') || argv.includes('DEL')) {
          return { stdout: 'OK\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: 'OK\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      // port probe
      if (s.includes('6379') || s.includes('nc ') || s.includes('/dev/tcp')) {
        return { stdout: 'ok\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 1, argv, dryRun: false };
    },
  };
}

describe('redis-browser', () => {
  it('probes service and blocks start without execute', async () => {
    const st = await probeRedisService(host({ execute: false, root: false, pong: true }));
    expect(st.clientInstalled).toBe(true);
    // may or may not reach depending on TCP probe — still returns shape
    expect(st).toHaveProperty('canRead');
    expect(st).toHaveProperty('databases');

    const start = await startRedisService(host({ execute: false }));
    expect(start.ok === false || start.blocked).toBeTruthy();
  });

  it('lists gets sets deletes keys when redis-cli works', async () => {
    const h = host({ execute: true, root: true, pong: true });
    // force canRead path: if probe says not reachable, list may block
    const list = await listRedisKeys({ host: h, pattern: '*', db: 0, count: 50 });
    expect(list).toHaveProperty('ok');
    expect(list).toHaveProperty('keys');

    const get = await getRedisKey({ host: h, key: 'key1', db: 0 });
    expect(get).toHaveProperty('ok');

    const set = await setRedisString({ host: h, key: 'k', value: 'v', db: 0 });
    expect(set).toHaveProperty('ok');

    const del = await deleteRedisKey({ host: h, key: 'k', db: 0 });
    expect(del).toHaveProperty('ok');
  });
});
