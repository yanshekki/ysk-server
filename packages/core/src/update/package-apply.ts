import { tl } from '@ysk/shared';
/**
 * Apply apt package upgrade from panel — fail-closed, honest notes.
 */

import type { HostExecutor } from '../host/executor.js';
import { withHostMutatingJob } from '../host/host-job.js';
import type { UpdateItemDto } from '@ysk/shared';
import { planUpdateExecution } from './advisor.js';

export async function applyPackageUpdate(input: {
  host: HostExecutor;
  item: UpdateItemDto;
  /** Operator confirmed high-risk apply */
  confirmHighRisk?: boolean;
  onLog?: (ev: { stream: 'stdout' | 'stderr'; line: string }) => void;
  abortSignal?: AbortSignal;
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

  // Serialize with runtime PHP/apt installs to avoid dpkg lock races
  return withHostMutatingJob(async () => {
    input.onLog?.({
      stream: 'stdout',
      line: `YSK_APT_UPGRADE ${pkg}=${cand}`,
    });
    const r = await input.host.runCommand(['bash', '-c', cmd], {
      timeoutMs: 300_000,
      onChunk: input.onLog
        ? (c) => input.onLog!({ stream: c.stream, line: c.text })
        : undefined,
      signal: input.abortSignal,
    });
    const out = ((r.stdout || '') + (r.stderr || '')).slice(0, 800);

    // Honest applied: exit 0 alone is not enough — verify dpkg version matches candidate
    const verR = await input.host.runCommand(
      [
        'bash',
        '-c',
        `dpkg-query -W -f='\${Version}' ${JSON.stringify(pkg)} 2>/dev/null || true`,
      ],
      { timeoutMs: 15_000 },
    );
    const installedNow = (verR.stdout || '').trim();
    const versionMatches = (have: string, want: string) => {
      if (!have || !want) return false;
      if (have === want) return true;
      // Epoch-tolerant: "2:1.0-1" vs "1.0-1"
      const stripEpoch = (v: string) => v.replace(/^\d+:/, '');
      return stripEpoch(have) === stripEpoch(want);
    };
    const versionOk =
      versionMatches(installedNow, cand) || versionMatches(installedNow, rawCand);
    const cmdOk = r.exitCode === 0;
    const applied = cmdOk && versionOk;
    const ok = applied;

    if (cmdOk && !versionOk) {
      notes.push(
        tl('notes.auto.t0462', { v0: r.exitCode }),
        `verify_failed: dpkg=${installedNow || '(none)'} wanted=${cand}`,
      );
    }

    return {
      ok,
      applied,
      notes: [
        ...notes,
        tl('notes.auto.t0460', { v0: input.item.currentVersion, v1: cand }),
        applied
          ? tl('notes.auto.t0461', { v0: pkg })
          : tl('notes.auto.t0462', { v0: r.exitCode }),
        installedNow ? `dpkg_now=${installedNow}` : 'dpkg_now=(none)',
        out.slice(0, 400),
      ],
      commands: [cmd],
      exitCode: r.exitCode,
    };
  });
}

export type PackageApplyResult = Awaited<ReturnType<typeof applyPackageUpdate>>;

export type BatchPackageApplyItem = {
  packageName: string;
  currentVersion: string;
  candidateVersion?: string;
  risk?: string;
  requiresApproval?: boolean;
  cves?: string[];
  summary?: string;
};

/**
 * Sequential multi-package apply — never silent full-system apt upgrade.
 * Caps batch size; each package uses the same fail-closed path as single apply.
 */
export async function applyPackageUpdateBatch(input: {
  host: HostExecutor;
  items: BatchPackageApplyItem[];
  confirmHighRisk?: boolean;
  /** Max packages per request (default 40) */
  limit?: number;
  /** Build UpdateItemDto from inventory fields (inject adviseUpdate from caller) */
  toItem: (row: BatchPackageApplyItem) => UpdateItemDto;
  onLog?: (ev: { stream: 'stdout' | 'stderr'; line: string }) => void;
  abortSignal?: AbortSignal;
  /** Fired after each package (for SSE progress) */
  onItemDone?: (row: {
    packageName: string;
    ok: boolean;
    applied: boolean;
    index: number;
    total: number;
  }) => void;
}): Promise<{
  ok: boolean;
  appliedCount: number;
  failedCount: number;
  results: Array<{
    packageName: string;
    ok: boolean;
    applied: boolean;
    blocked?: boolean;
    blockMessage?: string;
    notes: string[];
  }>;
  notes: string[];
}> {
  const limit = Math.min(Math.max(input.limit ?? 40, 1), 40);
  const slice = (input.items ?? []).slice(0, limit);
  const results: Array<{
    packageName: string;
    ok: boolean;
    applied: boolean;
    blocked?: boolean;
    blockMessage?: string;
    notes: string[];
  }> = [];
  const notes: string[] = [];

  if (!slice.length) {
    return {
      ok: false,
      appliedCount: 0,
      failedCount: 0,
      results: [],
      notes: [tl('notes.auto.n0640')],
    };
  }

  let appliedCount = 0;
  let failedCount = 0;
  let index = 0;
  for (const row of slice) {
    if (input.abortSignal?.aborted) {
      notes.push('batch aborted');
      break;
    }
    index += 1;
    const item = input.toItem(row);
    input.onLog?.({
      stream: 'stdout',
      line: `YSK_BATCH ${index}/${slice.length} ${item.packageName}`,
    });
    const r = await applyPackageUpdate({
      host: input.host,
      item,
      confirmHighRisk: input.confirmHighRisk,
      onLog: input.onLog,
      abortSignal: input.abortSignal,
    });
    if (r.ok && r.applied) appliedCount += 1;
    else failedCount += 1;
    input.onItemDone?.({
      packageName: item.packageName,
      ok: r.ok,
      applied: r.applied,
      index,
      total: slice.length,
    });
    results.push({
      packageName: item.packageName,
      ok: r.ok,
      applied: r.applied,
      blocked: r.blocked,
      blockMessage: r.blockMessage,
      notes: r.notes,
    });
  }

  notes.push(
    `batch=${slice.length} applied=${appliedCount} failed=${failedCount}`,
  );

  return {
    ok: failedCount === 0 && appliedCount > 0,
    appliedCount,
    failedCount,
    results,
    notes,
  };
}
