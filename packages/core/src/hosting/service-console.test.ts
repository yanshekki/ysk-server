import { describe, expect, it } from 'vitest';
import { getServiceConsole, lifecycleService } from './service-console.js';
import type { HostExecutor } from '../host/executor.js';

function host(opts: { execute?: boolean; root?: boolean; installed?: boolean }): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    // Only systemctl paths exist when not installed (HostSoftwareProbe also checks absolute bins)
    pathExists: (p) =>
      opts.installed === false ? p.includes('systemctl') : true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) => {
      const s = argv.join(' ');
      if (s.includes('command -v')) {
        return {
          stdout: opts.installed === false ? '' : '/usr/bin/x\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('is-active')) {
        return { stdout: 'inactive\n', stderr: '', exitCode: 3, argv, dryRun: false };
      }
      if (s.includes('is-enabled')) {
        return { stdout: 'disabled\n', stderr: '', exitCode: 1, argv, dryRun: false };
      }
      // live loaders may call mysql/redis — return empty
      return { stdout: '', stderr: '', exitCode: 1, argv, dryRun: false };
    },
  };
}

describe('service-console', () => {
  it('returns console dto and blocks lifecycle without execute', async () => {
    const h = host({ execute: false, root: false, installed: true });
    const dto = await getServiceConsole(h, 'redis');
    expect(dto.engine).toBe('redis');
    expect(dto.title).toBeTruthy();
    expect(dto.canLifecycle).toBe(false);
    expect(Array.isArray(dto.categories)).toBe(true);

    const life = await lifecycleService(h, 'mysql', 'restart');
    expect(life.blocked).toBe(true);

    const notInst = await getServiceConsole(
      host({ execute: true, root: true, installed: false }),
      'postgres',
    );
    expect(notInst.installed).toBe(false);
    expect(notInst.blockMessage).toMatch(/尚未安裝|權限/);
  });
});

describe('service-console lifecycle apply and live paths', () => {
  function richHost(opts: {
    execute?: boolean;
    root?: boolean;
    bins?: Record<string, boolean>;
    active?: string;
    redisPong?: boolean;
    configOk?: boolean;
  }): HostExecutor {
    const bins = opts.bins ?? {};
    return {
      executeEnabled: () => opts.execute !== false,
      isRoot: () => opts.root !== false,
      pathExists: (p) => {
        if (p.includes('systemctl')) return true;
        // Absolute bin paths only if that bin is marked present
        for (const [bin, on] of Object.entries(bins)) {
          if (on && p.endsWith(`/${bin}`)) return true;
        }
        return false;
      },
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
      runCommand: async (argv) => {
        const s = argv.join(' ');
        if (s.includes('command -v')) {
          const bin = s.match(/command -v (\S+)/)?.[1] ?? '';
          // Explicit map only — do not default-true (would make mariadbd always present)
          const present = bins[bin] === true;
          return {
            stdout: present ? `/usr/bin/${bin}\n` : '',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('is-active')) {
          return {
            stdout: `${opts.active ?? 'active'}\n`,
            stderr: '',
            exitCode: opts.active === 'active' || !opts.active ? 0 : 3,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('is-enabled')) {
          return { stdout: 'enabled\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('mysql --version') || (argv[0] === 'mysql' && argv[1] === '--version')) {
          return { stdout: 'mysql Ver 8.0\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'mysql' && s.includes('SHOW GLOBAL')) {
          return {
            stdout: 'port\t3306\nmax_connections\t151\nThreads_connected\t2\nUptime\t100\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (argv[0] === 'psql' && argv.includes('--version')) {
          return { stdout: 'psql 16\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'psql' && s.includes('SHOW')) {
          return { stdout: '5432\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'redis-cli' && argv.includes('PING')) {
          return {
            stdout: opts.redisPong === false ? 'NO\n' : 'PONG\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (argv[0] === 'redis-cli' && s.includes('INFO')) {
          return {
            stdout: 'redis_version:7.0.0\nused_memory_human:1M\nconnected_clients:3\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (argv[0] === 'redis-cli' && s.includes('CONFIG GET')) {
          return { stdout: 'port\n6379\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'redis-cli' && s.includes('CONFIG SET')) {
          return {
            stdout: opts.configOk === false ? 'ERR\n' : 'OK\n',
            stderr: '',
            exitCode: opts.configOk === false ? 1 : 0,
            argv,
            dryRun: false,
          };
        }
        if (argv[0] === 'redis-cli' && s.includes('CONFIG REWRITE')) {
          return { stdout: 'OK\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'mysql' && s.includes('SET GLOBAL')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'psql' && s.includes('ALTER SYSTEM')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'psql' && s.includes('pg_reload')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'systemctl') {
          if (argv.includes('reload')) {
            return { stdout: '', stderr: 'reload failed', exitCode: 1, argv, dryRun: false };
          }
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
  }

  it('loads mysql and redis live metrics when bins present', async () => {
    const { getServiceConsole, lifecycleService, applyConsoleSettings, installServiceEngine } =
      await import('./service-console.js');
    const mysql = await getServiceConsole(
      richHost({
        execute: true,
        root: true,
        bins: { mysqld: true, mysql: true, mariadbd: false },
        active: 'active',
      }),
      'mysql',
    );
    expect(mysql.installed).toBe(true);
    expect(mysql.canLifecycle).toBe(true);
    expect(mysql.version).toMatch(/mysql/i);
    expect(mysql.live.port || mysql.metrics.Threads_connected).toBeTruthy();
    expect(mysql.categories.length).toBeGreaterThan(0);

    const redis = await getServiceConsole(
      richHost({
        execute: true,
        root: true,
        bins: { 'redis-server': true, 'redis-cli': true },
        redisPong: true,
      }),
      'redis',
    );
    expect(redis.installed).toBe(true);
    expect(redis.version).toMatch(/Redis/i);
    expect(redis.metrics.used_memory || redis.live.port).toBeTruthy();

    const pg = await getServiceConsole(
      richHost({
        execute: false,
        root: false,
        bins: { postgres: true, psql: true },
      }),
      'postgres',
    );
    expect(pg.installed).toBe(true);
    expect(pg.canLifecycle).toBe(false);
    expect(pg.blockMessage).toBeTruthy();
  });

  it('lifecycle with root+execute and reload fallback', async () => {
    const { lifecycleService } = await import('./service-console.js');
    const h = richHost({ execute: true, root: true });
    const start = await lifecycleService(h, 'redis', 'start');
    expect(start.ok).toBe(true);
    const reload = await lifecycleService(h, 'redis', 'reload');
    // reload fails then restart succeeds
    expect(reload.ok).toBe(true);
    const noRoot = await lifecycleService(
      richHost({ execute: true, root: false }),
      'mysql',
      'stop',
    );
    expect(noRoot.blocked).toBe(true);
  });

  it('applyConsoleSettings redis mysql postgres honesty', async () => {
    const { applyConsoleSettings } = await import('./service-console.js');
    const redisOk = await applyConsoleSettings({
      host: richHost({
        execute: true,
        root: true,
        bins: { 'redis-cli': true },
        configOk: true,
      }),
      engine: 'redis',
      changes: { maxmemory: '100mb', 'maxmemory-policy': 'allkeys-lru' },
    });
    expect(redisOk.applied.length).toBeGreaterThan(0);

    const redisMissing = await applyConsoleSettings({
      host: richHost({ bins: { 'redis-cli': false } }),
      engine: 'redis',
      changes: { port: '6380' },
    });
    expect(redisMissing.blocked).toBe(true);

    const mysql = await applyConsoleSettings({
      host: richHost({ bins: { mysql: true } }),
      engine: 'mysql',
      changes: { max_connections: '200', innodb_buffer_pool_size: '128M' },
    });
    expect(mysql.ok).toBe(true);

    const pg = await applyConsoleSettings({
      host: richHost({ bins: { psql: true } }),
      engine: 'postgres',
      changes: { work_mem: '4MB' },
    });
    expect(pg.applied).toContain('work_mem');

    const pgMiss = await applyConsoleSettings({
      host: richHost({ bins: { psql: false } }),
      engine: 'postgres',
      changes: { port: '5433' },
    });
    expect(pgMiss.blocked).toBe(true);
  });

  it('installServiceEngine blocked without execute', async () => {
    const { installServiceEngine } = await import('./service-console.js');
    const r = await installServiceEngine(
      richHost({ execute: false, root: false, bins: {} }),
      'redis',
    );
    // software-install will block — honesty
    expect(r.ok === false || r.blocked === true || r.notes.length > 0).toBe(true);
  });
});
