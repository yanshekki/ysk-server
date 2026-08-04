import { describe, expect, it } from 'vitest';
import { planRepairFromFindings } from './diagnose.js';
import type { SqlFinding } from './types.js';

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
});
