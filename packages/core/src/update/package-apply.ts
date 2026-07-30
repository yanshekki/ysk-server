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
      blockMessage: '此更新需人工確認（高風險／需審批）。請勾選確認後再套用。',
      notes: [...notes, '已封鎖：需確認高風險更新'],
      commands: plan.commands,
    };
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      applied: false,
      blocked: true,
      blockMessage: '未開啟系統變更權限',
      notes: [...notes, '已封鎖：未開啟系統變更'],
      commands: plan.commands,
    };
  }
  if (!input.host.isRoot()) {
    return {
      ok: false,
      applied: false,
      blocked: true,
      blockMessage: '套件更新需要系統管理員權限',
      notes: [...notes, '已封鎖：需要管理員權限'],
      commands: plan.commands,
    };
  }

  const pkg = input.item.packageName.replace(/[^a-zA-Z0-9.+_-]/g, '');
  if (!pkg || pkg !== input.item.packageName) {
    return {
      ok: false,
      applied: false,
      notes: ['套件名不合法'],
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
          ? '沒有可套用的真實升級（缺 candidate 或與目前版本相同）'
          : 'candidateVersion 含非法字元',
      notes: [...notes, '已封鎖：無真實 candidateVersion'],
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
      `目標版本 ${input.item.currentVersion} → ${cand}`,
      ok ? `已嘗試升級 ${pkg}` : `升級失敗 exit=${r.exitCode}`,
      out.slice(0, 400),
    ],
    commands: [cmd],
    exitCode: r.exitCode,
  };
}
