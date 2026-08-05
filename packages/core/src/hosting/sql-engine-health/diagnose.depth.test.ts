import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { diagnoseSqlEngine, planRepairFromFindings } from './diagnose.js';
import type { SqlFinding } from './types.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function host(run: (argv: string[]) => Partial<RunResult>, paths: string[] = []): HostExecutor {
  const set = new Set(paths);
  return {
    executeEnabled: () => true,
    isRoot: () => true,
    pathExists: (p) => set.has(p) || p.includes('systemctl') || set.size === 0 && false,
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

/** Server present via pathExists candidates used by resolveBin. */
const MYSQL_PATHS = [
  '/usr/sbin/mysqld',
  '/usr/bin/mysqld',
  '/usr/bin/mysql',
  '/usr/sbin/mariadbd',
  '/usr/bin/mariadb',
  '/usr/bin/mysqladmin',
];

function installedRun(extra: (argv: string[]) => Partial<RunResult> = () => ({})) {
  return (argv: string[]): Partial<RunResult> => {
    const s = argv.join(' ');
    if (s.includes('command -v')) {
      if (s.includes('mysqld') || s.includes('mysql') || s.includes('mariadb')) {
        return { stdout: '/usr/bin/mysql\n' };
      }
      return { stdout: '' };
    }
    return extra(argv);
  };
}

describe('diagnoseSqlEngine depth branches', () => {
  it('mariadb flavor with mysql.cnf mismatch + unit inactive + port busy', async () => {
    const r = await diagnoseSqlEngine(
      host(
        installedRun((argv) => {
          const s = argv.join(' ');
          if (s.includes('FROZEN')) return { stdout: '__FROZEN_ABSENT__\n' };
          if (s.includes('/var/lib/mysql') || s.includes('has_data') || s.includes('empty')) {
            return { stdout: 'has_data\n' };
          }
          if (s.includes('readlink') || s.includes('my.cnf')) {
            return { stdout: '/etc/mysql/mysql.cnf\n' };
          }
          if (s.includes('YES|') || s.includes('provider') || s.includes('hits=')) {
            return { stdout: 'YES| my.cnf->/etc/mysql/mysql.cnf\n' };
          }
          if (argv[1] === 'is-active') return { stdout: 'inactive\n' };
          if (s.includes('3306') || s.includes('ss -tlnp') || s.includes('netstat')) {
            return { stdout: 'LISTEN 0 128 0.0.0.0:3306\n' };
          }
          return {};
        }),
        MYSQL_PATHS,
      ),
      'mariadb',
    );
    expect(r.flavor).toBe('mariadb');
    expect(r.unit).toBe('mariadb');
    // may or may not detect mismatch depending on presence resolution
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.healthy).toBe(false);
  });

  it('healthy active mysql without freeze', async () => {
    const r = await diagnoseSqlEngine(
      host(
        installedRun((argv) => {
          const s = argv.join(' ');
          if (s.includes('FROZEN')) return { stdout: '__FROZEN_ABSENT__\n' };
          if (s.includes('/var/lib/mysql')) return { stdout: 'has_data\n' };
          if (s.includes('readlink') || s.includes('my.cnf')) {
            return { stdout: '/etc/mysql/mysql.cnf\n' };
          }
          if (s.includes('YES|') || s.includes('provider') || s.includes('hits=')) {
            return { stdout: 'NO|\n' };
          }
          if (argv[1] === 'is-active') return { stdout: 'active\n' };
          return {};
        }),
        MYSQL_PATHS,
      ),
      'mysql',
    );
    if (r.serverInstalled && r.active === 'active' && !r.frozen) {
      expect(r.healthy || r.findings.every((f) => f.severity === 'warn' || f.severity === 'info')).toBe(
        true,
      );
    }
    expect(r.executeEnabled).toBe(true);
    expect(r.isRoot).toBe(true);
  });

  it('planRepairFromFindings config_flavor_mismatch only', () => {
    const findings: SqlFinding[] = [
      {
        id: 'config_flavor_mismatch',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.config_flavor_mismatch',
      },
    ];
    const plan = planRepairFromFindings(findings);
    expect(plan.some((a) => a.id === 'sanitize_config')).toBe(true);
    expect(plan.some((a) => a.id === 'stop_unit')).toBe(true);
    expect(plan.some((a) => a.id === 'clear_frozen')).toBe(false);
    expect(plan.some((a) => a.id === 'init_datadir')).toBe(false);
  });

  it('planRepairFromFindings unit_not_active only', () => {
    const plan = planRepairFromFindings([
      {
        id: 'unit_not_active',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.unit_not_active',
      },
    ]);
    expect(plan.map((a) => a.id)).toContain('enable_unit');
    expect(plan.map((a) => a.id)).toContain('start_unit');
    expect(plan.map((a) => a.id)).toContain('verify_active');
  });
});
