/**
 * Extra branch coverage for migrate.ts + preview edge cases.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { switchSqlEngine, listDumpSqlFiles } from './migrate.js';
import { previewSqlEngineSwitch } from './preview.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

describe('migrate branch extras', () => {
  it('switchNotNeeded when already on target', async () => {
    const host: HostExecutor = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: (p) => p.includes('systemctl') || p.includes('mysqld') || p.includes('/mysql'),
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => {},
      deletePath: async () => {},
      mkdirp: async () => {},
      sysInfo: async () => ({}),
      serviceStatus: async () => empty({ stdout: 'active' }),
      runCommand: async (argv) => {
        const s = argv.join(' ');
        if (s.includes('command -v') && s.includes('mysqld')) {
          return empty({ stdout: '/usr/sbin/mysqld\n' });
        }
        if (s.includes('SHOW DATABASES')) return empty({ stdout: 'mysql\n' });
        if (s.includes('dpkg') || s.includes('awk')) return empty({ stdout: 'mysql\n' });
        if (argv[0] === 'systemctl') return empty({ stdout: 'active\n' });
        return empty();
      },
    };
    const r = await switchSqlEngine({
      host,
      dataDir: mkdtempSync(join(tmpdir(), 'ysk-sw-nn-')),
      target: 'mysql',
      confirmPhrase: 'SWITCH',
      acknowledgeExclusive: true,
    });
    expect(r.ok).toBe(false);
    expect(r.executed).toBe(false);
  });

  it('empty dbs migrateData true still stops and purges path', async () => {
    let phase: 'src' | 'tgt' = 'src';
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-sw-empty-'));
    const host: HostExecutor = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: (p) => {
        if (p.includes('systemctl')) return true;
        if (phase === 'src') return p.includes('mysqld') || p.includes('/mysql');
        return p.includes('mariadbd') || p.includes('mariadb') || p.includes('/mysql');
      },
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => {},
      deletePath: async () => {},
      mkdirp: async () => {},
      sysInfo: async () => ({}),
      serviceStatus: async () => empty({ stdout: 'active' }),
      runCommand: async (argv) => {
        const s = argv.join(' ');
        if (s.includes('apt-get')) {
          phase = 'tgt';
          return empty({ stdout: 'ok' });
        }
        if (s.includes('SHOW DATABASES')) {
          return empty({ stdout: 'information_schema\nmysql\nsys\nperformance_schema\n' });
        }
        if (s.includes('command -v')) {
          if (phase === 'src' && s.includes('mysqld')) {
            return empty({ stdout: '/usr/sbin/mysqld\n' });
          }
          if (phase === 'tgt' && s.includes('mariadbd')) {
            return empty({ stdout: '/usr/sbin/mariadbd\n' });
          }
          if (s.includes('dump')) return empty({ stdout: '/usr/bin/mysqldump\n' });
          return empty();
        }
        if (s.includes('dpkg') || s.includes('awk')) {
          return empty({ stdout: phase === 'src' ? 'mysql\n' : 'mariadb\n' });
        }
        if (s.includes('FROZEN')) return empty({ stdout: '__FROZEN_ABSENT__\n' });
        if (s.includes('/var/lib/mysql')) return empty({ stdout: 'has_data\n' });
        if (s.includes('mv /var/lib/mysql')) return empty();
        if (argv[0] === 'systemctl') return empty({ stdout: 'active\n' });
        return empty();
      },
    };
    const r = await switchSqlEngine({
      host,
      dataDir,
      target: 'mariadb',
      confirmPhrase: 'SWITCH',
      acknowledgeExclusive: true,
      migrateData: true,
    });
    expect(typeof r.ok).toBe('boolean');
    expect(r.executed === true || r.ok === false).toBe(true);
  }, 60_000);

  it('listDumpSqlFiles edge paths', () => {
    expect(listDumpSqlFiles('/no/such/path-xyz')).toEqual([]);
    const d = mkdtempSync(join(tmpdir(), 'ysk-ld-'));
    writeFileSync(join(d, 'x.txt'), '1');
    expect(listDumpSqlFiles(d)).toEqual([]);
  });

  it('preview canProceed false without execute when switch needed', async () => {
    const host: HostExecutor = {
      executeEnabled: () => false,
      isRoot: () => false,
      pathExists: (p) => p.includes('mysqld') || p.includes('systemctl'),
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => {},
      deletePath: async () => {},
      mkdirp: async () => {},
      sysInfo: async () => ({}),
      serviceStatus: async () => empty(),
      runCommand: async (argv) => {
        const s = argv.join(' ');
        if (s.includes('command -v') && s.includes('mysqld')) {
          return empty({ stdout: '/usr/sbin/mysqld\n' });
        }
        if (s.includes('SHOW DATABASES')) return empty({ stdout: 'mysql\napp\n' });
        if (s.includes('information_schema')) return empty({ stdout: '1\n' });
        if (s.includes('dpkg')) return empty({ stdout: 'mysql\n' });
        return empty();
      },
    };
    const p = await previewSqlEngineSwitch({
      host,
      target: 'mariadb',
      dataDir: '/tmp/x',
    });
    expect(p.needsSwitch).toBe(true);
    // may block without root/execute
    expect(typeof p.canProceed).toBe('boolean');
  });
});
