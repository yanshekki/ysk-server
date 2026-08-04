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

  it('dump failure aborts with failed_safe and never purges', async () => {
    const called: string[] = [];
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      flavor: 'mariadb',
      dbs: ['appdb'],
      run: (argv) => {
        const s = argv.join(' ');
        called.push(s.slice(0, 120));
        if (s.includes('SHOW DATABASES')) {
          return {
            stdout: 'information_schema\nmysql\nappdb\n',
            exitCode: 0,
          };
        }
        if (s.includes('information_schema.tables')) {
          return { stdout: '1\n', exitCode: 0 };
        }
        if (s.includes('command -v')) {
          if (s.includes('mariadbd')) return { stdout: '/usr/sbin/mariadbd\n', exitCode: 0 };
          if (s.includes('mysqldump') || s.includes('mariadb-dump')) {
            return { stdout: '/usr/bin/mysqldump\n', exitCode: 0 };
          }
          return { stdout: '', exitCode: 0 };
        }
        if (s.includes('dpkg') || s.includes('awk')) {
          return { stdout: 'mariadb\n', exitCode: 0 };
        }
        // dump fails
        if (s.includes('mysqldump') || s.includes('mariadb-dump') || s.includes('--databases')) {
          return { stdout: 'dump error', stderr: 'access denied', exitCode: 1 };
        }
        if (argv[0] === 'systemctl') {
          return { stdout: 'active\n', exitCode: 0 };
        }
        return { exitCode: 0 };
      },
    });
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-sw-dumpfail-'));
    const r = await switchSqlEngine({
      host,
      dataDir,
      target: 'mysql',
      confirmPhrase: 'SWITCH',
      acknowledgeExclusive: true,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('failed_safe');
    expect(r.dumpPath).toBeTruthy();
    const joined = called.join('\n');
    expect(joined).not.toMatch(/apt-get (remove|purge)/);
    expect(joined).not.toMatch(/mv \/var\/lib\/mysql/);
  });

  it('datadir mv failure restarts source and does not purge', async () => {
    const called: string[] = [];
    let dumpWritten = false;
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      flavor: 'mariadb',
      dbs: ['appdb'],
      run: (argv) => {
        const s = argv.join(' ');
        called.push(s.slice(0, 160));
        if (s.includes('SHOW DATABASES')) {
          return { stdout: 'mysql\nappdb\n', exitCode: 0 };
        }
        if (s.includes('information_schema.tables')) {
          return { stdout: '2\n', exitCode: 0 };
        }
        if (s.includes('command -v')) {
          if (s.includes('mariadbd')) return { stdout: '/usr/sbin/mariadbd\n', exitCode: 0 };
          if (s.includes('dump')) return { stdout: '/usr/bin/mysqldump\n', exitCode: 0 };
          return { stdout: '', exitCode: 0 };
        }
        if (s.includes('dpkg') || s.includes('awk')) {
          return { stdout: 'mariadb\n', exitCode: 0 };
        }
        if (s.includes('--databases') || s.includes('mysqldump')) {
          // write a non-empty dump file path from redirect - dumpOneDatabase checks existsSync
          // The redirect creates file in real FS from shell - mock doesn't create file.
          // Force success by making exit 0 and pre-create via note: dump checks size after command.
          dumpWritten = true;
          return { stdout: '', exitCode: 0 };
        }
        if (s.includes('mysql.user') || s.includes('SHOW GRANTS')) {
          return { stdout: '', exitCode: 0 };
        }
        if (s.includes('mv /var/lib/mysql')) {
          return { stdout: '', stderr: 'permission denied', exitCode: 1 };
        }
        if (argv[0] === 'systemctl' && argv.includes('start')) {
          return { stdout: '', exitCode: 0 };
        }
        if (argv[0] === 'systemctl') {
          return { stdout: 'active\n', exitCode: 0 };
        }
        return { exitCode: 0 };
      },
    });
    // dumpOneDatabase requires file exists with size - mock won't create. Patch by writing after failed empty:
    // Actually empty dump returns failed_safe at dump phase. Need real write in dump mock.
    // Use host that writes file when dump runs:
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-sw-mvfail-'));
    const host2: HostExecutor = {
      ...host,
      runCommand: async (argv) => {
        const s = argv.join(' ');
        called.push(s.slice(0, 160));
        if (s.includes('SHOW DATABASES')) {
          return { stdout: 'mysql\nappdb\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('information_schema.tables')) {
          return { stdout: '2\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('command -v')) {
          if (s.includes('mariadbd')) {
            return { stdout: '/usr/sbin/mariadbd\n', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          if (s.includes('dump')) {
            return { stdout: '/usr/bin/mysqldump\n', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('dpkg') || s.includes('awk')) {
          return { stdout: 'mariadb\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('--databases') || s.includes('mysqldump')) {
          // Extract output path from `> "path"`
          const m = s.match(/>\s*"([^"]+)"/) || s.match(/>\s*'([^']+)'/) || s.match(/>\s*(\S+\.sql)/);
          if (m?.[1]) {
            const { writeFileSync, mkdirSync } = await import('node:fs');
            const { dirname } = await import('node:path');
            mkdirSync(dirname(m[1]), { recursive: true });
            writeFileSync(m[1], '-- dump\nCREATE DATABASE appdb;\n');
            dumpWritten = true;
          }
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('mysql.user') || s.includes('SHOW GRANTS')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('mv /var/lib/mysql')) {
          return { stdout: '', stderr: 'permission denied', exitCode: 1, argv, dryRun: false };
        }
        if (argv[0] === 'systemctl') {
          return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    const r = await switchSqlEngine({
      host: host2,
      dataDir,
      target: 'mysql',
      confirmPhrase: 'SWITCH',
      acknowledgeExclusive: true,
    });
    expect(dumpWritten).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('failed_safe');
    expect(called.some((c) => c.includes('apt-get'))).toBe(false);
    expect(called.some((c) => c.includes('systemctl') && c.includes('start'))).toBe(true);
  });
});

describe('getSoftware mysql-server exists', () => {
  it('catalog has mysql-server and mariadb-server', () => {
    expect(getSoftware('mysql-server')?.units).toContain('mysql');
    expect(getSoftware('mariadb-server')?.units).toContain('mariadb');
  });
});
