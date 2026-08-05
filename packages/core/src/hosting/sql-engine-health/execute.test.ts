import { describe, expect, it, vi, afterEach } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { executeSqlEngineRepair } from './execute.js';
import type { SqlEngineHealthReport } from './types.js';
import * as diagnoseMod from './diagnose.js';
import * as actionsMod from './actions.js';
import {
  executeSqlEngineRepairAsRecover,
  unfreezeViaHealth,
} from './compat.js';
import { waitUnitActiveHelper } from './actions.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts?: {
  execute?: boolean;
  root?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts?.execute ?? true,
    isRoot: () => opts?.root ?? true,
    pathExists: () => false,
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

function baseReport(over: Partial<SqlEngineHealthReport> = {}): SqlEngineHealthReport {
  return {
    flavor: 'mysql',
    unit: 'mysql',
    healthy: false,
    serverInstalled: true,
    clientInstalled: true,
    active: 'inactive',
    findings: [
      {
        id: 'unit_not_active',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.unit_not_active',
      },
    ],
    repairPlan: [
      {
        id: 'stop_unit',
        because: ['unit_not_active'],
        requiresConfirm: false,
        messageKey: 'sqlEngineHealth.action.stop_unit',
      },
      {
        id: 'reset_failed',
        because: ['unit_not_active'],
        requiresConfirm: false,
        messageKey: 'sqlEngineHealth.action.reset_failed',
      },
      {
        id: 'enable_unit',
        because: ['unit_not_active'],
        requiresConfirm: false,
        messageKey: 'sqlEngineHealth.action.enable_unit',
      },
      {
        id: 'start_unit',
        because: ['unit_not_active'],
        requiresConfirm: false,
        messageKey: 'sqlEngineHealth.action.start_unit',
      },
    ],
    requiresConfirm: false,
    frozen: false,
    datadirUninitialized: false,
    executeEnabled: true,
    isRoot: true,
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('executeSqlEngineRepair', () => {
  it('blocks without execute/root', async () => {
    const r = await executeSqlEngineRepair({
      host: mockHost({ execute: false }),
      flavor: 'mysql',
      confirm: true,
    });
    expect(r.blocked).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('returns already healthy without running plan', async () => {
    const report = baseReport({
      healthy: true,
      active: 'active',
      findings: [],
      repairPlan: [],
      requiresConfirm: false,
    });
    const r = await executeSqlEngineRepair({
      host: mockHost(),
      flavor: 'mysql',
      confirm: true,
      report,
    });
    expect(r.ok).toBe(true);
    expect(r.steps).toHaveLength(0);
  });

  it('needs_confirm when plan requires it and confirm false', async () => {
    const report = baseReport({
      requiresConfirm: true,
      repairPlan: [
        {
          id: 'clear_frozen',
          because: ['frozen_marker'],
          requiresConfirm: true,
          messageKey: 'sqlEngineHealth.action.clear_frozen',
        },
      ],
      findings: [
        {
          id: 'frozen_marker',
          severity: 'error',
          messageKey: 'sqlEngineHealth.finding.frozen_marker',
        },
      ],
    });
    const r = await executeSqlEngineRepair({
      host: mockHost(),
      flavor: 'mysql',
      confirm: false,
      report,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('needs_confirm');
  });

  it('refuses when package_missing', async () => {
    const report = baseReport({
      serverInstalled: false,
      findings: [
        {
          id: 'package_missing',
          severity: 'blocker',
          messageKey: 'sqlEngineHealth.finding.package_missing',
        },
      ],
      repairPlan: [],
    });
    const r = await executeSqlEngineRepair({
      host: mockHost(),
      flavor: 'mariadb',
      confirm: true,
      report,
    });
    expect(r.ok).toBe(false);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('runs unit lifecycle actions and re-diagnoses', async () => {
    const cmds: string[][] = [];
    const after = baseReport({
      healthy: true,
      active: 'active',
      findings: [],
      repairPlan: [],
      requiresConfirm: false,
    });
    vi.spyOn(diagnoseMod, 'diagnoseSqlEngine').mockResolvedValue(after);

    const r = await executeSqlEngineRepair({
      host: mockHost({
        run: (argv) => {
          cmds.push([...argv]);
          if (argv[0] === 'systemctl' && argv[1] === 'start') {
            return { exitCode: 0 };
          }
          return {};
        },
      }),
      flavor: 'mysql',
      confirm: true,
      report: baseReport(),
    });
    expect(r.ok).toBe(true);
    expect(r.steps.length).toBeGreaterThanOrEqual(3);
    expect(cmds.some((a) => a[0] === 'systemctl' && a[1] === 'start')).toBe(true);
  });

  it('aborts when start_unit fails', async () => {
    const after = baseReport({ healthy: false, active: 'failed' });
    vi.spyOn(diagnoseMod, 'diagnoseSqlEngine').mockResolvedValue(after);

    const r = await executeSqlEngineRepair({
      host: mockHost({
        run: (argv) => {
          if (argv[0] === 'systemctl' && argv[1] === 'start') {
            return { exitCode: 1, stderr: 'start failed' };
          }
          return {};
        },
      }),
      flavor: 'mysql',
      confirm: true,
      report: baseReport({
        repairPlan: [
          {
            id: 'start_unit',
            because: ['unit_not_active'],
            requiresConfirm: false,
            messageKey: 'sqlEngineHealth.action.start_unit',
          },
        ],
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.steps.some((s) => s.id === 'start_unit' && s.status === 'failed')).toBe(true);
  });

  it('runs clear_frozen / sanitize / init / verify action branches', async () => {
    vi.spyOn(actionsMod, 'clearMysqlFrozen').mockResolvedValue({
      ok: true,
      notes: ['cleared'],
    } as never);
    vi.spyOn(actionsMod, 'sanitizeSqlConfigForFlavor').mockResolvedValue({
      ok: true,
      notes: ['sanitized'],
    } as never);
    vi.spyOn(actionsMod, 'initializeMysqlDatadirIfEmpty').mockResolvedValue({
      ok: true,
      initialized: true,
      notes: ['init'],
    } as never);
    vi.spyOn(actionsMod, 'waitUnitActiveHelper').mockResolvedValue(true);

    const after = baseReport({
      healthy: true,
      active: 'active',
      findings: [],
      repairPlan: [],
    });
    vi.spyOn(diagnoseMod, 'diagnoseSqlEngine').mockResolvedValue(after);

    const r = await executeSqlEngineRepair({
      host: mockHost(),
      flavor: 'mariadb',
      confirm: true,
      report: baseReport({
        requiresConfirm: true,
        frozen: true,
        datadirUninitialized: true,
        findings: [
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
        ],
        repairPlan: [
          {
            id: 'clear_frozen',
            because: ['frozen_marker'],
            requiresConfirm: true,
            messageKey: 'sqlEngineHealth.action.clear_frozen',
          },
          {
            id: 'sanitize_config',
            because: ['residual_foreign_plugins'],
            requiresConfirm: true,
            messageKey: 'sqlEngineHealth.action.sanitize_config',
          },
          {
            id: 'init_datadir',
            because: ['datadir_uninitialized'],
            requiresConfirm: true,
            messageKey: 'sqlEngineHealth.action.init_datadir',
          },
          {
            id: 'verify_active',
            because: ['unit_not_active'],
            requiresConfirm: false,
            messageKey: 'sqlEngineHealth.action.verify_active',
          },
        ],
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.id)).toEqual([
      'clear_frozen',
      'sanitize_config',
      'init_datadir',
      'verify_active',
    ]);
    expect(r.steps.every((s) => s.status === 'ok')).toBe(true);
  });

  it('marks init_datadir skipped when not initialized; clear fails abort', async () => {
    vi.spyOn(actionsMod, 'initializeMysqlDatadirIfEmpty').mockResolvedValue({
      ok: true,
      initialized: false,
      notes: ['already has data'],
    } as never);
    vi.spyOn(diagnoseMod, 'diagnoseSqlEngine').mockResolvedValue(
      baseReport({ healthy: false, active: 'inactive' }),
    );

    const skipInit = await executeSqlEngineRepair({
      host: mockHost(),
      flavor: 'mysql',
      confirm: true,
      report: baseReport({
        repairPlan: [
          {
            id: 'init_datadir',
            because: ['datadir_uninitialized'],
            requiresConfirm: true,
            messageKey: 'sqlEngineHealth.action.init_datadir',
          },
        ],
        requiresConfirm: true,
      }),
    });
    expect(skipInit.steps[0]?.status).toBe('skipped');

    vi.spyOn(actionsMod, 'clearMysqlFrozen').mockResolvedValue({
      ok: false,
      notes: ['cannot clear'],
    } as never);
    const failClear = await executeSqlEngineRepair({
      host: mockHost(),
      flavor: 'mysql',
      confirm: true,
      report: baseReport({
        requiresConfirm: true,
        repairPlan: [
          {
            id: 'clear_frozen',
            because: ['frozen_marker'],
            requiresConfirm: true,
            messageKey: 'sqlEngineHealth.action.clear_frozen',
          },
        ],
      }),
    });
    expect(failClear.ok).toBe(false);
    expect(failClear.steps[0]?.status).toBe('failed');
  });
});

describe('compat adapters', () => {
  it('unfreezeViaHealth blocks without confirm', async () => {
    vi.spyOn(diagnoseMod, 'diagnoseSqlEngine').mockResolvedValue(
      baseReport({
        requiresConfirm: true,
        frozen: true,
        findings: [
          {
            id: 'frozen_marker',
            severity: 'error',
            messageKey: 'sqlEngineHealth.finding.frozen_marker',
          },
        ],
        repairPlan: [
          {
            id: 'clear_frozen',
            because: ['frozen_marker'],
            requiresConfirm: true,
            messageKey: 'sqlEngineHealth.action.clear_frozen',
          },
        ],
      }),
    );
    // execute re-diagnoses when report omitted — spy covers it
    const r = await unfreezeViaHealth(mockHost(), 'mysql', { confirm: false });
    expect(r.ok).toBe(false);
  });

  it('executeSqlEngineRepairAsRecover maps shape', async () => {
    const before = baseReport({
      healthy: true,
      active: 'active',
      findings: [],
      repairPlan: [],
      frozen: false,
    });
    vi.spyOn(diagnoseMod, 'diagnoseSqlEngine').mockResolvedValue(before);
    const r = await executeSqlEngineRepairAsRecover(mockHost(), 'mysql');
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.steps)).toBe(true);
    expect(Array.isArray(r.notes)).toBe(true);
  });
});

describe('waitUnitActiveHelper', () => {
  it('returns true when unit becomes active', async () => {
    let n = 0;
    const host = mockHost({
      run: (argv) => {
        if (argv[1] === 'is-active') {
          n += 1;
          return { stdout: n >= 1 ? 'active\n' : 'activating\n' };
        }
        return {};
      },
    });
    // pathExists false → unitIsActive may short-circuit; force via run + systemctl path
    const host2: HostExecutor = {
      ...host,
      pathExists: (p) => p.includes('systemctl'),
    };
    const ok = await waitUnitActiveHelper(host2, 'mysql', 5_000);
    expect(ok).toBe(true);
  });
});
