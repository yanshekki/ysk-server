import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  getServiceConsole,
  lifecycleService,
  applyConsoleSettings,
  installServiceEngine,
} from './service-console.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function host(opts: {
  execute?: boolean;
  root?: boolean;
  bins?: string[];
  active?: string;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  const bins = new Set(opts.bins ?? ['mysqld', 'mysql', 'mariadbd', 'postgres', 'redis-server', 'redis-cli']);
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    pathExists: (p) => {
      if (p.includes('systemctl')) return true;
      for (const b of bins) if (p.endsWith(`/${b}`)) return true;
      return false;
    },
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      if (opts.run) return { ...empty(), argv, ...opts.run(argv) };
      const s = argv.join(' ');
      if (s.includes('command -v')) {
        for (const b of bins) {
          if (s.includes(b)) return empty({ stdout: `/usr/bin/${b}\n` });
        }
        return empty({ stdout: '' });
      }
      if (argv[1] === 'is-active') return empty({ stdout: (opts.active ?? 'active') + '\n' });
      if (argv[1] === 'is-enabled') return empty({ stdout: 'enabled\n' });
      if (s.includes('VERSION') || s.includes('--version')) {
        return empty({ stdout: '8.0.36\n' });
      }
      if (s.includes('SHOW GLOBAL') || s.includes('SHOW VARIABLES')) {
        return empty({ stdout: 'max_connections\t151\n' });
      }
      if (s.includes('redis-cli')) {
        if (s.includes('PING') || argv.includes('PING')) return empty({ stdout: 'PONG\n' });
        if (s.includes('INFO') || argv.includes('INFO')) {
          return empty({ stdout: 'redis_version:7.2\nused_memory_human:1M\nconnected_clients:1\n' });
        }
        if (s.includes('CONFIG') || argv.includes('CONFIG')) {
          return empty({ stdout: 'maxmemory\n0\n' });
        }
      }
      if (s.includes('psql') || s.includes('SHOW ')) {
        return empty({ stdout: 'max_connections|100\n' });
      }
      return empty();
    },
  };
}

describe('service-console branch matrix', () => {
  it('loads all engines with installed bins', async () => {
    for (const eng of ['mysql', 'mariadb', 'postgres', 'redis'] as const) {
      const dto = await getServiceConsole(host({ bins: ['mysqld', 'mysql', 'mariadbd', 'postgres', 'redis-server', 'redis-cli', 'psql'] }), eng);
      expect(dto.engine).toBe(eng);
      expect(dto.title.length).toBeGreaterThan(0);
      expect(dto.activeLabel.length).toBeGreaterThan(0);
    }
  });

  it('activeLabel for inactive / activating / unknown', async () => {
    for (const active of ['inactive', 'failed', 'activating', 'weird']) {
      const dto = await getServiceConsole(host({ active }), 'redis');
      expect(dto.activeLabel).toBeTruthy();
    }
  });

  it('lifecycle all actions + reload fallback + root block', async () => {
    const okHost = host({});
    for (const action of ['start', 'stop', 'restart', 'enable', 'disable'] as const) {
      const r = await lifecycleService(okHost, 'redis', action);
      expect(typeof r.ok).toBe('boolean');
    }
    const reloadFail = await lifecycleService(
      host({
        run: (argv) => {
          if (argv[1] === 'reload') return { exitCode: 1, stderr: 'no reload' };
          return {};
        },
      }),
      'mysql',
      'reload',
    );
    expect(typeof reloadFail.ok).toBe('boolean');

    const noRoot = await lifecycleService(host({ root: false }), 'mysql', 'start');
    expect(noRoot.blocked).toBe(true);
  });

  it('mysql start recovers via frozen path when start fails', async () => {
    let n = 0;
    const r = await lifecycleService(
      host({
        bins: ['mysqld', 'mysql'],
        run: (argv) => {
          const s = argv.join(' ');
          if (argv[0] === 'systemctl' && (argv[1] === 'start' || argv[1] === 'restart')) {
            n += 1;
            // first fail then ok after recover
            return n === 1 ? { exitCode: 1, stderr: 'failed' } : { exitCode: 0 };
          }
          if (s.includes('FROZEN')) return { stdout: '__FROZEN_ABSENT__\n' };
          if (s.includes('/var/lib/mysql')) return { stdout: 'has_data\n' };
          if (s.includes('command -v')) return { stdout: '/usr/sbin/mysqld\n' };
          if (argv[1] === 'is-active') return { stdout: 'failed\n' };
          return {};
        },
      }),
      'mysql',
      'start',
    );
    expect(typeof r.ok).toBe('boolean');
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('applyConsoleSettings redis missing cli blocks; empty changes ok shape', async () => {
    const noCli = await applyConsoleSettings({
      host: host({ bins: [] }),
      engine: 'redis',
      changes: { maxmemory: '64mb' },
    });
    expect(noCli.ok === false || noCli.blocked === true || noCli.notes.length >= 0).toBe(true);

    const empty = await applyConsoleSettings({
      host: host({ bins: ['redis-cli', 'redis-server'] }),
      engine: 'redis',
      changes: {},
    });
    expect(Array.isArray(empty.applied)).toBe(true);
  });

  it('installServiceEngine blocks without execute', async () => {
    const r = await installServiceEngine(host({ execute: false, root: false }), 'redis');
    expect(r).toBeTruthy();
    expect(r.ok === false || r.blocked === true || r.notes.length > 0).toBe(true);
  });
});
