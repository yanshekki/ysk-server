import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { previewSqlEngineSwitch } from './preview.js';
import { switchSqlEngine, EXCLUSIVE_SWITCH_AUTH } from './migrate.js';
import { installSoftware } from '../software-install.js';
import { getSoftware } from '../software-catalog.js';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  flavor?: 'mysql' | 'mariadb' | 'none';
  dbs?: string[];
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  const flavor = opts.flavor ?? 'none';
  const dbs = opts.dbs ?? ['appdb'];
  return {
    executeEnabled: () => opts.executeEnabled === true,
    isRoot: () => opts.isRoot === true,
    pathExists: (p) => {
      if (p.includes('systemctl')) return true;
      if (flavor === 'mariadb' && (p.includes('mariadbd') || p.endsWith('/mariadbd'))) return true;
      if (flavor === 'mysql' && (p.includes('mysqld') || p.endsWith('/mysqld'))) return true;
      return false;
    },
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: 'active',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => {
      if (opts.run) {
        const partial = opts.run(argv);
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
          ...partial,
        };
      }
      const s = argv.join(' ');
      if (s.includes('command -v')) {
        if (flavor === 'mariadb' && s.includes('mariadbd')) {
          return { stdout: '/usr/sbin/mariadbd\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (flavor === 'mysql' && s.includes('mysqld')) {
          return { stdout: '/usr/sbin/mysqld\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('mysqldump') || s.includes('mariadb-dump')) {
          return { stdout: '/usr/bin/mysqldump\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (s.includes('SHOW DATABASES')) {
        return {
          stdout: ['information_schema', 'mysql', 'sys', ...dbs].join('\n') + '\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('information_schema.tables')) {
        return { stdout: '3\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (s.includes('dpkg') || s.includes('mariadb-server') || s.includes('mysql-server')) {
        if (flavor === 'mariadb') {
          return { stdout: 'mariadb\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (flavor === 'mysql') {
          return { stdout: 'mysql\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
      }
      if (argv[0] === 'systemctl' && argv.includes('is-active')) {
        return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('sql-engine-switch', () => {
  it('preview: MariaDB host targeting mysql needs switch + lists dbs', async () => {
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      flavor: 'mariadb',
      dbs: ['shop', 'blog'],
    });
    const p = await previewSqlEngineSwitch({
      host,
      target: 'mysql',
      dataDir: '/tmp/ysk-test',
    });
    expect(p.needsSwitch).toBe(true);
    expect(p.canProceed).toBe(true);
    expect(p.currentFlavor).toBe('mariadb');
    expect(p.target).toBe('mysql');
    expect(p.databases.map((d) => d.name).sort()).toEqual(['blog', 'shop']);
    expect(p.confirmPhrase).toBe('SWITCH');
    expect(p.warnings.length).toBeGreaterThan(2);
  });

  it('preview: no switch when flavor already matches', async () => {
    const host = mockHost({ executeEnabled: true, isRoot: true, flavor: 'mysql' });
    const p = await previewSqlEngineSwitch({ host, target: 'mysql', dataDir: '/tmp/x' });
    expect(p.needsSwitch).toBe(false);
  });

  it('switch rejects bad confirmPhrase without mutation notes about purge', async () => {
    const host = mockHost({ executeEnabled: true, isRoot: true, flavor: 'mariadb' });
    const r = await switchSqlEngine({
      host,
      dataDir: mkdtempSync(join(tmpdir(), 'ysk-sw-')),
      target: 'mysql',
      confirmPhrase: 'yes',
      acknowledgeExclusive: true,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('needs_confirm');
    expect(r.executed).toBe(false);
  });

  it('switch rejects without acknowledgeExclusive', async () => {
    const host = mockHost({ executeEnabled: true, isRoot: true, flavor: 'mariadb' });
    const r = await switchSqlEngine({
      host,
      dataDir: mkdtempSync(join(tmpdir(), 'ysk-sw-')),
      target: 'mysql',
      confirmPhrase: 'SWITCH',
      acknowledgeExclusive: false,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('needs_confirm');
  });

  it('installSoftware mysql-server under MariaDB returns needs_exclusive_switch', async () => {
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      flavor: 'mariadb',
    });
    const r = await installSoftware({ host, id: 'mysql-server' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('needs_exclusive_switch');
    expect(r.switchTarget).toBe('mysql');
    expect(r.blockedByExclusive).toBe('mariadb-server');
    expect(r.executed).toBe(false);
  });

  it('installSoftware with exclusiveSwitchAuth is not blocked by exclusive gate alone', async () => {
    // Without server packages after "none" flavor, auth just allows past gate
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      flavor: 'none',
    });
    // still may fail install due to apt, but must not return needs_exclusive_switch
    const r = await installSoftware({
      host,
      id: 'mysql-server',
      exclusiveSwitchAuth: EXCLUSIVE_SWITCH_AUTH,
    });
    expect(r.code).not.toBe('needs_exclusive_switch');
  });
});

describe('getSoftware mysql-server exists', () => {
  it('catalog has mysql-server and mariadb-server', () => {
    expect(getSoftware('mysql-server')?.units).toContain('mysql');
    expect(getSoftware('mariadb-server')?.units).toContain('mariadb');
  });
});
