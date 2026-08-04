import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { dumpRedisRdb } from './redis-dump.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts: {
  execute?: boolean;
  hasCli?: boolean;
  rdbOk?: boolean;
  bgsaveOk?: boolean;
  cfgDir?: string;
  cfgName?: string;
  copyOk?: boolean;
  writeRdbPath?: boolean;
}): HostExecutor {
  return {
    pathExists: (p) => {
      // When testing missing redis-cli, do not let real host /usr/bin/redis-cli leak in
      if (opts.hasCli === false && /redis-cli$/.test(p)) return false;
      return existsSync(p);
    },
    isRoot: () => true,
    executeEnabled: () => opts.execute ?? false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      const script = typeof argv[2] === 'string' ? argv[2] : argv.join(' ');
      if (script.includes('command -v')) {
        return {
          ...empty(),
          stdout:
            opts.hasCli === false
              ? ''
              : script.includes('redis-cli')
                ? '/usr/bin/redis-cli\n'
                : '',
          argv,
        };
      }
      if (script.includes('--rdb')) {
        if (opts.rdbOk) {
          const m = script.match(/--rdb\s+("([^"]+)"|'([^']+)'|(\S+))/);
          const out = m?.[2] || m?.[3] || m?.[4];
          if (out && opts.writeRdbPath !== false) {
            mkdirSync(join(out, '..'), { recursive: true });
            writeFileSync(out, 'REDIS0009mock');
          }
          return { ...empty(), exitCode: 0, argv };
        }
        return { ...empty(), exitCode: 1, stderr: 'ERR unknown option --rdb', argv };
      }
      if (script.includes('BGSAVE')) {
        return {
          ...empty(),
          exitCode: opts.bgsaveOk === false ? 1 : 0,
          stdout: opts.bgsaveOk === false ? 'ERR' : 'Background saving started',
          argv,
        };
      }
      if (script.includes('LASTSAVE') || script.includes('INFO persistence')) {
        return {
          ...empty(),
          stdout: 'rdb_bgsave_in_progress:0\nBackground saving terminated\n',
          argv,
        };
      }
      if (script.includes('CONFIG GET')) {
        const dir = opts.cfgDir ?? '/var/lib/redis';
        const name = opts.cfgName ?? 'dump.rdb';
        return {
          ...empty(),
          stdout: `dir\n${dir}\ndbfilename\n${name}\n`,
          argv,
        };
      }
      if (script.includes('YSK_RDB_') || script.includes('cp -a')) {
        if (opts.copyOk) {
          const m = script.match(
            /cp -a\s+("([^"]+)"|'([^']+)')\s+("([^"]+)"|'([^']+)')/,
          );
          const src = m?.[2] || m?.[3];
          const dest = m?.[5] || m?.[6];
          if (src && dest && existsSync(src)) {
            writeFileSync(dest, readFileSync(src));
          }
          return { ...empty(), stdout: 'YSK_RDB_COPIED\n', argv };
        }
        return { ...empty(), stdout: 'YSK_RDB_MISSING\n', argv };
      }
      return { ...empty(), argv };
    },
  };
}

describe('dumpRedisRdb', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-rdb-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('blocks without execute (honesty)', async () => {
    const out = join(dir, 'out.rdb');
    const r = await dumpRedisRdb({
      host: mockHost({ execute: false }),
      outputPath: out,
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.requiresExecute).toBe(true);
    expect(r.apply_status === 'applied').toBe(false);
  });

  it('blocks when redis-cli missing', async () => {
    const r = await dumpRedisRdb({
      host: mockHost({ execute: true, hasCli: false }),
      outputPath: join(dir, 'a.rdb'),
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('uses --rdb method when available', async () => {
    const out = join(dir, 'snap.rdb');
    const r = await dumpRedisRdb({
      host: mockHost({ execute: true, hasCli: true, rdbOk: true }),
      outputPath: out,
    });
    expect(r.ok).toBe(true);
    expect(r.method).toBe('rdb-flag');
    expect(r.path).toBe(out);
    expect((r.bytes ?? 0) > 0).toBe(true);
    expect(r.apply_status).toBe('written');
    expect(existsSync(out)).toBe(true);
  });

  it('falls back to BGSAVE+copy', async () => {
    const redisDir = join(dir, 'redis-data');
    mkdirSync(redisDir, { recursive: true });
    writeFileSync(join(redisDir, 'dump.rdb'), 'REDIS-BGSAVE-COPY');
    const out = join(dir, 'from-bgsave.rdb');
    const r = await dumpRedisRdb({
      host: mockHost({
        execute: true,
        hasCli: true,
        rdbOk: false,
        bgsaveOk: true,
        cfgDir: redisDir,
        cfgName: 'dump.rdb',
        copyOk: true,
      }),
      outputPath: out,
      bgsaveTimeoutMs: 2_000,
    });
    expect(r.ok).toBe(true);
    expect(r.method).toBe('bgsave-copy');
    expect(existsSync(out)).toBe(true);
  });

  it('fails when bgsave and rdb both fail', async () => {
    const r = await dumpRedisRdb({
      host: mockHost({
        execute: true,
        hasCli: true,
        rdbOk: false,
        bgsaveOk: false,
      }),
      outputPath: join(dir, 'fail.rdb'),
    });
    expect(r.ok).toBe(false);
    expect(r.apply_status).toBe('failed');
  });

  it('fails when dump file never materializes', async () => {
    const r = await dumpRedisRdb({
      host: mockHost({
        execute: true,
        hasCli: true,
        rdbOk: false,
        bgsaveOk: true,
        cfgDir: join(dir, 'empty-redis'),
        copyOk: false,
      }),
      outputPath: join(dir, 'missing.rdb'),
      bgsaveTimeoutMs: 1_000,
    });
    expect(r.ok).toBe(false);
  });
});
