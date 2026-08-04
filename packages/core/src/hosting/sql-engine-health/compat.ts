/**
 * Compatibility adapters so existing unfreeze/recover call sites use the
 * generic health pipeline without one-off branching.
 */

import type { HostExecutor } from '../../host/executor.js';
import { executeSqlEngineRepair } from './execute.js';
import { diagnoseSqlEngine } from './diagnose.js';
import type { SqlEngineFlavor } from './types.js';

/** Map old recoverMysqlAfterEngineSwitch shape → health execute */
export async function executeSqlEngineRepairAsRecover(
  host: HostExecutor,
  flavor: SqlEngineFlavor,
): Promise<{
  ok: boolean;
  notes: string[];
  steps: Array<{ name: string; status: string; detail?: string }>;
  frozenBefore?: boolean;
  initialized?: boolean;
}> {
  const before = await diagnoseSqlEngine(host, flavor);
  const r = await executeSqlEngineRepair({ host, flavor, confirm: true, report: before });
  return {
    ok: r.ok,
    notes: r.notes,
    steps: r.steps.map((s) => ({
      name: s.id,
      status: s.status,
      detail: s.detail,
    })),
    frozenBefore: before.frozen,
    initialized: before.datadirUninitialized && r.ok,
  };
}

export { executeSqlEngineRepairAsRecover as recoverMysqlAfterEngineSwitch };

export async function unfreezeViaHealth(
  host: HostExecutor,
  flavor: SqlEngineFlavor,
  opts?: { confirm?: boolean },
): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  steps: Array<{ name: string; status: string; detail?: string }>;
  code?: string;
}> {
  const r = await executeSqlEngineRepair({
    host,
    flavor,
    confirm: opts?.confirm === true,
  });
  return {
    ok: r.ok,
    blocked: r.blocked,
    blockMessage: r.blockMessage,
    notes: r.notes,
    steps: r.steps.map((s) => ({
      name: s.id,
      status: s.status,
      detail: s.detail,
    })),
    code: r.code,
  };
}
