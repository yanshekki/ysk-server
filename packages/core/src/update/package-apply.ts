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

  // Prefer apt-get only-upgrade; candidate may not match exact =version on all distros
  const cmd = `export DEBIAN_FRONTEND=noninteractive; apt-get install -y --only-upgrade ${JSON.stringify(pkg)} 2>&1`;
  const r = await input.host.runCommand(['bash', '-c', cmd], { timeoutMs: 300_000 });
  const out = ((r.stdout || '') + (r.stderr || '')).slice(0, 800);
  const ok = r.exitCode === 0;
  return {
    ok,
    applied: ok,
    notes: [
      ...notes,
      ok ? `已嘗試升級 ${pkg}` : `升級失敗 exit=${r.exitCode}`,
      out.slice(0, 400),
    ],
    commands: [cmd],
    exitCode: r.exitCode,
  };
}
