/**
 * Execute a SQL engine repair plan produced by diagnose + planRepairFromFindings.
 */

import { tl } from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import { panelBlockMessage } from '../system-apply.js';
import {
  clearMysqlFrozen,
  sanitizeSqlConfigForFlavor,
  initializeMysqlDatadirIfEmpty,
  waitUnitActiveHelper,
} from './actions.js';
import { diagnoseSqlEngine } from './diagnose.js';
import type {
  SqlEngineFlavor,
  SqlEngineHealthReport,
  SqlRepairAction,
  SqlRepairResult,
  SqlRepairStepResult,
} from './types.js';

export async function executeSqlEngineRepair(input: {
  host: HostExecutor;
  flavor: SqlEngineFlavor;
  /** Must be true to run destructive steps */
  confirm: boolean;
  /** Optional precomputed report */
  report?: SqlEngineHealthReport;
}): Promise<SqlRepairResult> {
  const host = input.host;
  if (!host.executeEnabled() || !host.isRoot()) {
    const reason = !host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(reason);
    return { ok: false, blocked: true, blockMessage, notes: [blockMessage], steps: [] };
  }

  const report = input.report ?? (await diagnoseSqlEngine(host, input.flavor));
  if (report.healthy && report.repairPlan.length === 0) {
    return {
      ok: true,
      notes: [tl('sqlEngineHealth.note.alreadyHealthy')],
      steps: [],
      healthAfter: report,
    };
  }

  if (report.requiresConfirm && input.confirm !== true) {
    return {
      ok: false,
      code: 'needs_confirm',
      notes: [
        tl('sqlEngineHealth.note.needsConfirm', {
          count: report.repairPlan.length,
          findings: report.findings.map((f) => f.id).join(','),
        }),
      ],
      steps: [],
      healthAfter: report,
    };
  }

  if (report.findings.some((f) => f.id === 'package_missing')) {
    return {
      ok: false,
      notes: [tl('sqlEngineHealth.note.installPackageFirst', { flavor: input.flavor })],
      steps: [],
      healthAfter: report,
    };
  }

  const notes: string[] = [];
  const steps: SqlRepairStepResult[] = [];
  const unit = report.unit;

  // Surface findings as notes (localized keys)
  for (const f of report.findings) {
    notes.push(tl(f.messageKey, f.params as Record<string, string | number> | undefined));
  }

  for (const action of report.repairPlan) {
    const step = await runAction(host, input.flavor, unit, action);
    steps.push(step);
    if (step.status === 'failed') {
      notes.push(
        tl('sqlEngineHealth.note.stepFailed', {
          action: action.id,
          detail: step.detail || '',
        }),
      );
      const healthAfter = await diagnoseSqlEngine(host, input.flavor);
      return { ok: false, notes, steps, healthAfter };
    }
  }

  const healthAfter = await diagnoseSqlEngine(host, input.flavor);
  const ok = healthAfter.healthy && healthAfter.active === 'active';
  notes.push(
    ok
      ? tl('sqlEngineHealth.note.repairOk', { unit })
      : tl('sqlEngineHealth.note.repairIncomplete', { active: healthAfter.active }),
  );
  return { ok, notes, steps, healthAfter };
}

async function runAction(
  host: HostExecutor,
  flavor: SqlEngineFlavor,
  unit: string,
  action: SqlRepairAction,
): Promise<SqlRepairStepResult> {
  switch (action.id) {
    case 'stop_unit': {
      await host.runCommand(['systemctl', 'stop', unit], { timeoutMs: 60_000 });
      return { id: action.id, status: 'ok' };
    }
    case 'clear_frozen': {
      const r = await clearMysqlFrozen(host);
      return {
        id: action.id,
        status: r.ok ? 'ok' : 'failed',
        detail: r.notes.join('; '),
      };
    }
    case 'sanitize_config': {
      const r = await sanitizeSqlConfigForFlavor(host, flavor);
      return {
        id: action.id,
        status: r.ok ? 'ok' : 'failed',
        detail: r.notes.join('; '),
      };
    }
    case 'init_datadir': {
      const r = await initializeMysqlDatadirIfEmpty(host, flavor);
      return {
        id: action.id,
        status: r.ok ? (r.initialized ? 'ok' : 'skipped') : 'failed',
        detail: r.notes.join('; '),
      };
    }
    case 'reset_failed': {
      await host.runCommand(['systemctl', 'reset-failed', unit], { timeoutMs: 10_000 });
      return { id: action.id, status: 'ok' };
    }
    case 'enable_unit': {
      await host.runCommand(['systemctl', 'enable', unit], { timeoutMs: 60_000 });
      return { id: action.id, status: 'ok' };
    }
    case 'start_unit': {
      const r = await host.runCommand(['systemctl', 'start', unit], { timeoutMs: 120_000 });
      return {
        id: action.id,
        status: r.exitCode === 0 ? 'ok' : 'failed',
        detail: r.exitCode === 0 ? undefined : (r.stderr || r.stdout).slice(0, 300),
      };
    }
    case 'verify_active': {
      const ok = await waitUnitActiveHelper(host, unit, 90_000);
      return {
        id: action.id,
        status: ok ? 'ok' : 'failed',
        detail: ok ? 'active' : 'not active',
      };
    }
    default:
      return { id: action.id, status: 'skipped', detail: 'unknown action' };
  }
}
