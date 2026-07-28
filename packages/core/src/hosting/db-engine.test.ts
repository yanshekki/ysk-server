import { describe, expect, it } from 'vitest';
import { probeDbEngine, startDbEngine } from './db-engine.js';
import type { HostExecutor, RunResult } from '../host/executor.js';

function host(opts: {
  execute?: boolean;
  root?: boolean;
  answers?: Record<string, string>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    pathExists: (p) => p.includes('systemctl'),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) => {
      const s = argv.join(' ');
      const ans = opts.answers ?? {};
      for (const [k, v] of Object.entries(ans)) {
        if (s.includes(k)) {
          return { stdout: v, stderr: '', exitCode: 0, argv, dryRun: false } as RunResult;
        }
      }
      return { stdout: '', stderr: '', exitCode: 1, argv, dryRun: false };
    },
  };
}

describe('db-engine', () => {
  it('probes mysql/mariadb and blocks start without execute', async () => {
    const h = host({
      execute: false,
      root: false,
      answers: {
        'command -v mysql': '/usr/bin/mysql\n',
        'command -v mariadbd': '',
        'command -v mysqld': '/usr/sbin/mysqld\n',
        "dpkg -l": 'mysql\n',
        'is-active mysql': 'inactive\n',
        'is-active mysqld': 'inactive\n',
        'mysql --version': 'mysql 8.0\n',
      },
    });
    const st = await probeDbEngine(h, 'mysql');
    expect(st.clientInstalled).toBe(true);
    expect(st.executeEnabled).toBe(false);
    expect(st.canProvision).toBe(false);

    const start = await startDbEngine({ host: h, engine: 'mysql' });
    expect(start.blocked).toBe(true);

    const maria = host({
      answers: {
        'command -v mariadbd': '/usr/sbin/mariadbd\n',
        'command -v mysql': '/usr/bin/mysql\n',
        'is-active mariadb': 'active\n',
        'mysql --version': 'mariadb\n',
      },
    });
    const ms = await probeDbEngine(maria, 'mariadb');
    expect(ms.serverInstalled).toBe(true);
  });
});
