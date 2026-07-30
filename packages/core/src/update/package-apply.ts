import { tl } from '@ysk/shared';
/**
 * Apply apt package upgrade from panel — fail-closed, honest notes.
 */

import type { HostExecutor } from '../host/executor.js';
import type { UpdateItemDto } from '@ysk/shared';
import { planUpdateExecution } from './advisor.js';

export async function applyPackageUpdate(input: {
  host: HostExecutor;
  item: UpdateItemDto;
  /** Operator confirmed high-risk apply */
  confirmHighRisk?: boolean;
}): Promise<{
  ok: boolean;
  applied: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  commands: string[];
  exitCode?: number;
}> {
  const plan = planUpdateExecution(input.item);
  const notes: string[] = [...Object.entries(plan.audit).map(([k, v]) => `${k}=${v}`)];
  notes.push(`mode=${plan.mode}`);

  if (plan.mode === 'approval' && !input.confirmHighRisk) {
    return {
      ok: false,
      applied: false,
      blocked: true,
      blockMessage: tl('notes.auto.n1038'),
      notes: [...notes, tl('notes.auto.n0771')],
      commands: plan.commands,
    };
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      applied: false,
      blocked: true,
      blockMessage: tl('ops.blocked.needExecuteShort'),
      notes: [...notes, tl('ops.blocked.needExecuteBlocked')],
      commands: plan.commands,
    };
  }
  if (!input.host.isRoot()) {
    return {
      ok: false,
      applied: false,
      blocked: true,
      blockMessage: tl('notes.auto.n0642'),
      notes: [...notes, tl('notes.auto.n0772')],
      commands: plan.commands,
    };
  }

  const pkg = input.item.packageName.replace(/[^a-zA-Z0-9.+_-]/g, '');
  if (!pkg || pkg !== input.item.packageName) {
    return {
      ok: false,
      applied: false,
      notes: [tl('notes.auto.n0640')],
      commands: plan.commands,
    };
  }

  const rawCand = (input.item.candidateVersion ?? '').trim();
  const cand = rawCand.replace(/[^a-zA-Z0-9.+~:_-]/g, '');
  const hasCand =
    Boolean(cand) &&
    cand === rawCand &&
    cand !== input.item.currentVersion;

  if (!hasCand) {
    return {
      ok: false,
      applied: false,
      blocked: true,
      blockMessage:
        !rawCand || rawCand === input.item.currentVersion
          ? tl('notes.auto.n1048')
          : tl('notes.auto.n0234'),
      notes: [...notes, tl('notes.auto.n0770')],
      commands: [],
    };
  }

  // Exact candidate only — never fall back to unversioned upgrade (wrong version risk)
  const cmd = `export DEBIAN_FRONTEND=noninteractive; apt-get install -y --only-upgrade ${JSON.stringify(pkg)}=${JSON.stringify(cand)} 2>&1`;

  const r = await input.host.runCommand(['bash', '-c', cmd], { timeoutMs: 300_000 });
  const out = ((r.stdout || '') + (r.stderr || '')).slice(0, 800);
  const ok = r.exitCode === 0;
  return {
    ok,
    applied: ok,
    notes: [
      ...notes,
      tl('notes.auto.t0460', { v0: (input.item.currentVersion), v1: (cand) }),
      ok ? tl('notes.auto.t0461', { v0: (pkg) }) : tl('notes.auto.t0462', { v0: (r.exitCode) }),
      out.slice(0, 400),
    ],
    commands: [cmd],
    exitCode: r.exitCode,
  };
}
