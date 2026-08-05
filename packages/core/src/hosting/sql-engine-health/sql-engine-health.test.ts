import { describe, expect, it } from 'vitest';
import { planRepairFromFindings, diagnoseSqlEngine } from './diagnose.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { SqlFinding } from './types.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts?: {
  execute?: boolean;
  root?: boolean;
  paths?: string[];
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  const paths = new Set(opts?.paths ?? []);
  return {
    executeEnabled: () => opts?.execute ?? true,
    isRoot: () => opts?.root ?? true,
    pathExists: (p) => paths.has(p) || p.includes('systemctl'),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv, ...(opts?.run?.(argv) ?? {}) }),
  };
}

describe('sql-engine-health plan', () => {
  it('builds ordered plan from multiple findings (not FROZEN-only)', () => {
    const findings: SqlFinding[] = [
      {
        id: 'frozen_marker',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.frozen_marker',
      },
      {
        id: 'residual_foreign_plugins',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.residual_foreign_plugins',
      },
      {
        id: 'datadir_uninitialized',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.datadir_uninitialized',
      },
      {
        id: 'unit_failed',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.unit_failed',
      },
    ];
    const plan = planRepairFromFindings(findings);
    const ids = plan.map((a) => a.id);
    expect(ids[0]).toBe('stop_unit');
    expect(ids).toContain('clear_frozen');
    expect(ids).toContain('sanitize_config');
    expect(ids).toContain('init_datadir');
    expect(ids).toContain('start_unit');
    expect(ids[ids.length - 1]).toBe('verify_active');
    // order: clear before init before start
    expect(ids.indexOf('clear_frozen')).toBeLessThan(ids.indexOf('init_datadir'));
    expect(ids.indexOf('sanitize_config')).toBeLessThan(ids.indexOf('start_unit'));
  });

  it('empty findings → empty plan', () => {
    expect(planRepairFromFindings([])).toEqual([]);
  });

  it('client_missing alone does not force repair plan', () => {
    const plan = planRepairFromFindings([
      {
        id: 'client_missing',
        severity: 'warn',
        messageKey: 'sqlEngineHealth.finding.client_missing',
      },
    ]);
    expect(plan).toEqual([]);
  });
});

describe('diagnoseSqlEngine', () => {
  it('reports package_missing when server bins absent', async () => {
    const r = await diagnoseSqlEngine(
      mockHost({
        paths: [],
        run: () => ({ stdout: '', exitCode: 1 }),
      }),
      'mysql',
    );
    expect(r.serverInstalled).toBe(false);
    expect(r.findings.some((f) => f.id === 'package_missing')).toBe(true);
    expect(r.healthy).toBe(false);
  });

  it('detects frozen + inactive when server present', async () => {
    const r = await diagnoseSqlEngine(
      mockHost({
        paths: ['/usr/sbin/mysqld', '/usr/bin/mysqld', '/usr/bin/mysql'],
        run: (argv) => {
          const s = argv.join(' ');
          if (s.includes('command -v') && s.includes('mysql')) {
            return { stdout: '/usr/bin/mysql\n' };
          }
          if (s.includes('command -v') && s.includes('mysqld')) {
            return { stdout: '/usr/sbin/mysqld\n' };
          }
          if (s.includes('FROZEN')) {
            return {
              stdout: '__FROZEN_PRESENT__\nfrozen-mode/downgrade\n',
            };
          }
          if (s.includes('/var/lib/mysql')) {
            return { stdout: 'empty\n' };
          }
          if (argv[1] === 'is-active') return { stdout: 'failed\n' };
          if (s.includes('my.cnf') || s.includes('readlink')) {
            return { stdout: '/etc/mysql/mariadb.cnf\n' };
          }
          return {};
        },
      }),
      'mysql',
    );
    expect(r.findings.some((f) => f.id === 'frozen_marker')).toBe(true);
    expect(r.repairPlan.length).toBeGreaterThan(0);
    expect(r.requiresConfirm).toBe(true);
  });
});
