import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  probeRedisService,
  startRedisService,
  listRedisKeys,
  getRedisKey,
  setRedisString,
  deleteRedisKey,
  installRedisService,
} from './redis-browser.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(
  run: (argv: string[]) => Partial<RunResult>,
  opts?: { execute?: boolean; root?: boolean; pathExists?: boolean | ((p: string) => boolean) },
): HostExecutor {
  const pe = opts?.pathExists;
  return {
    executeEnabled: () => opts?.execute ?? true,
    isRoot: () => opts?.root ?? true,
    pathExists:
      typeof pe === 'function' ? pe : pe === false ? () => false : () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv, ...run(argv) }),
  };
}

describe('redis-browser depth', () => {
  it('probe parses full INFO and keyspace; handles missing client', async () => {
    const host = mockHost((argv) => {
      const j = argv.join(' ');
      if (j.includes('command -v') && j.includes('redis-cli')) {
        return { exitCode: 0, stdout: '/usr/bin/redis-cli\n' };
      }
      if (j.includes('command -v') && j.includes('redis-server')) {
        return { exitCode: 0, stdout: '/usr/bin/redis-server\n' };
      }
      if (j.includes('is-active')) return { exitCode: 0, stdout: 'active\n' };
      if (j.includes('6379') || j.includes('/dev/tcp') || j.includes('nc ')) {
        return { exitCode: 0, stdout: 'ok' };
      }
      if (argv[0] === 'redis-cli') {
        if (argv.includes('PING')) return { stdout: 'PONG\n' };
        if (argv.includes('server')) return { stdout: 'redis_version:7.2.0\n' };
        if (argv.includes('memory')) return { stdout: 'used_memory_human:2.5M\n' };
        if (argv.includes('clients')) return { stdout: 'connected_clients:3\n' };
        if (argv.includes('keyspace')) {
          return { stdout: 'db0:keys=5,expires=1,avg_ttl=9\ndb1:keys=2\n' };
        }
        if (argv.includes('databases')) return { stdout: 'databases\n32\n' };
      }
      return { exitCode: 1 };
    });
    const st = await probeRedisService(host);
    expect(st.clientInstalled).toBe(true);
    if (st.canRead) {
      expect(st.version).toBe('7.2.0');
      expect(st.usedMemory).toBe('2.5M');
      expect(st.keyspace.length).toBeGreaterThanOrEqual(1);
      expect(st.databases).toBe(32);
    }

    const noCli = mockHost(
      (argv) => {
        if (argv.join(' ').includes('command -v')) return { exitCode: 1, stdout: '' };
        return { exitCode: 1 };
      },
      { execute: false, root: false, pathExists: false },
    );
    const missing = await probeRedisService(noCli);
    expect(missing.clientInstalled).toBe(false);
    expect(missing.blockMessage).toBeTruthy();
  });

  it('startRedisService with root enables unit; without root blocks', async () => {
    const blocked = await startRedisService(
      mockHost(() => ({}), { execute: true, root: false }),
    );
    expect(blocked.blocked).toBe(true);

    const ok = await startRedisService(
      mockHost((argv) => {
        const j = argv.join(' ');
        if (j.includes('command -v')) return { stdout: '/bin/redis-cli\n' };
        if (j.includes('is-active')) return { stdout: 'active\n' };
        if (j.includes('6379') || j.includes('/dev/tcp')) return { exitCode: 0 };
        if (argv.includes('PING')) return { stdout: 'PONG\n' };
        if (argv.includes('INFO')) return { stdout: 'redis_version:7\n' };
        if (argv.includes('CONFIG')) return { stdout: 'databases\n16\n' };
        if (argv[0] === 'systemctl') return { exitCode: 0 };
        return {};
      }),
    );
    expect(ok.notes.length).toBeGreaterThan(0);
  });

  it('listRedisKeys scan fallback to KEYS; getRedisKey all types', async () => {
    let mode: 'scan-fail' | 'types' = 'scan-fail';
    const host = mockHost((argv) => {
      const j = argv.join(' ');
      if (j.includes('command -v redis-cli')) return { stdout: '/usr/bin/redis-cli\n' };
      if (argv[0] !== 'redis-cli') return { exitCode: 1 };

      if (mode === 'scan-fail') {
        if (argv.includes('--scan')) return { exitCode: 1, stderr: 'scan fail' };
        if (argv.includes('KEYS')) return { stdout: 'a\nb\n' };
        if (argv.includes('TYPE')) return { stdout: 'string\n' };
        if (argv.includes('TTL')) return { stdout: '60\n' };
        return {};
      }

      // types mode for getRedisKey
      const typeCmd = argv.includes('TYPE');
      const key = argv[argv.length - 1];
      if (typeCmd) {
        if (key === 'h') return { stdout: 'hash\n' };
        if (key === 'l') return { stdout: 'list\n' };
        if (key === 's') return { stdout: 'set\n' };
        if (key === 'z') return { stdout: 'zset\n' };
        if (key === 'missing') return { stdout: 'none\n' };
        if (key === 'other') return { stdout: 'stream\n' };
        return { stdout: 'string\n' };
      }
      if (argv.includes('TTL')) return { stdout: '-1\n' };
      if (argv.includes('GET')) return { stdout: 'val' };
      if (argv.includes('HGETALL')) return { stdout: 'f1\nv1\nf2\nv2\n' };
      if (argv.includes('LRANGE')) return { stdout: 'i1\ni2\n' };
      if (argv.includes('SMEMBERS')) return { stdout: 'm1\nm2\n' };
      if (argv.includes('ZRANGE')) return { stdout: 'z1\n1\nz2\n2\n' };
      return {};
    });

    const list = await listRedisKeys({ host, pattern: '*', count: 10 });
    expect(list.ok).toBe(true);
    expect(list.keys.length).toBeGreaterThanOrEqual(1);

    mode = 'types';
    const hash = await getRedisKey({ host, key: 'h' });
    expect(hash.ok).toBe(true);
    expect(typeof hash.view?.value).toBe('object');

    const listV = await getRedisKey({ host, key: 'l' });
    expect(listV.ok).toBe(true);
    expect(Array.isArray(listV.view?.value)).toBe(true);

    const setV = await getRedisKey({ host, key: 's' });
    expect(setV.ok).toBe(true);

    const z = await getRedisKey({ host, key: 'z' });
    expect(z.ok).toBe(true);
    expect(Array.isArray(z.view?.value)).toBe(true);

    const none = await getRedisKey({ host, key: 'missing' });
    expect(none.ok).toBe(false);

    const other = await getRedisKey({ host, key: 'other' });
    expect(other.ok).toBe(true);

    const set = await setRedisString({ host, key: 'k', value: 'v', ttl: 30 });
    expect(set.executed).toBe(true);

    const tooBig = await setRedisString({
      host,
      key: 'big',
      value: 'x'.repeat(300_000),
    });
    expect(tooBig.ok).toBe(false);

    const del = await deleteRedisKey({ host, key: 'k' });
    expect(del.executed).toBe(true);
  });

  it('validation rejects bad db/key/pattern; missing cli blocks writes', async () => {
    const noCli = mockHost(() => ({ exitCode: 1 }), { execute: false, pathExists: false });
    await expect(listRedisKeys({ host: noCli, db: 0 })).resolves.toMatchObject({ ok: false });
    await expect(setRedisString({ host: noCli, key: 'a', value: 'b' })).resolves.toMatchObject({
      blocked: true,
    });
    await expect(deleteRedisKey({ host: noCli, key: 'a' })).resolves.toMatchObject({
      blocked: true,
    });

    const host = mockHost((argv) => {
      if (argv.join(' ').includes('command -v')) return { stdout: '/bin/redis-cli\n' };
      return { exitCode: 0, stdout: 'OK\n' };
    });
    await expect(listRedisKeys({ host, db: -1 })).rejects.toThrow();
    await expect(listRedisKeys({ host, db: 99 })).rejects.toThrow();
    await expect(getRedisKey({ host, key: 'bad key!' })).rejects.toThrow();
    await expect(getRedisKey({ host, key: '' })).rejects.toThrow();
    // pattern with spaces rejected
    await expect(listRedisKeys({ host, pattern: 'has space' })).rejects.toThrow();
  });

  it(
    'installRedisService returns notes from software install honesty',
    async () => {
      const r = await installRedisService({
        host: mockHost(
          (argv) => {
            const j = argv.join(' ');
            if (j.includes('command -v')) return { exitCode: 1, stdout: '' };
            return { exitCode: 1, stderr: 'no apt' };
          },
          { execute: false, root: false, pathExists: false },
        ),
      });
      expect(r.notes.length).toBeGreaterThan(0);
      expect(typeof r.ok).toBe('boolean');
    },
    15_000,
  );
});
