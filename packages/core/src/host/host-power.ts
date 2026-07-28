/**
 * Host power actions (reboot / poweroff / cancel) — fail-closed.
 * Uses `shutdown` so cancel works; never bare `reboot` without policy.
 */

import type { HostExecutor } from './executor.js';

export type HostPowerAction = 'reboot' | 'poweroff' | 'cancel';

export type HostPowerResult = {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  action: HostPowerAction;
  delaySec?: number;
  scheduledAt?: string;
  executeEnabled?: boolean;
  isRoot?: boolean;
};

const CONFIRM: Record<Exclude<HostPowerAction, 'cancel'>, string> = {
  reboot: 'REBOOT',
  poweroff: 'POWEROFF',
};

/** Default delay (seconds) when caller omits delaySec. */
export const DEFAULT_POWER_DELAY: Record<Exclude<HostPowerAction, 'cancel'>, number> = {
  reboot: 10,
  poweroff: 60,
};

export async function hostPowerAction(input: {
  host: HostExecutor;
  action: HostPowerAction;
  confirm?: string;
  /** Seconds until action; 0 = now. Ignored for cancel. */
  delaySec?: number;
}): Promise<HostPowerResult> {
  const notes: string[] = [];
  const executeEnabled = input.host.executeEnabled();
  const isRoot = input.host.isRoot();
  const action = input.action;

  if (action !== 'reboot' && action !== 'poweroff' && action !== 'cancel') {
    return {
      ok: false,
      notes: ['未知電源動作'],
      action: action as HostPowerAction,
      executeEnabled,
      isRoot,
    };
  }

  if (!executeEnabled || !isRoot) {
    return {
      ok: false,
      blocked: true,
      blockMessage: '無法執行電源操作：需要系統變更權限（YSK_EXECUTE）與 root',
      notes: ['需要 YSK_EXECUTE=1 與 root'],
      action,
      executeEnabled,
      isRoot,
    };
  }

  if (action === 'cancel') {
    const r = await input.host.runCommand(['shutdown', '-c'], { timeoutMs: 15_000 });
    const ok = r.exitCode === 0;
    notes.push(
      ok
        ? '已取消排程關機／重啟'
        : `取消失敗: ${(r.stderr || r.stdout || '').trim() || `exit ${r.exitCode}`}`,
    );
    return { ok, notes, action, executeEnabled, isRoot };
  }

  const need = CONFIRM[action];
  if ((input.confirm ?? '').trim() !== need) {
    return {
      ok: false,
      notes: [`請在 confirm 欄位輸入正確字串：${need}`],
      action,
      executeEnabled,
      isRoot,
    };
  }

  let delaySec =
    typeof input.delaySec === 'number' && Number.isFinite(input.delaySec)
      ? Math.floor(input.delaySec)
      : DEFAULT_POWER_DELAY[action];
  if (delaySec < 0) delaySec = 0;
  if (delaySec > 3600) delaySec = 3600;

  // Classic `shutdown +N` is minutes. Sub-minute UI delays ceil to 1 minute — honest note.
  let used: string[];
  if (delaySec === 0) {
    used = action === 'reboot' ? ['shutdown', '-r', 'now'] : ['shutdown', '-h', 'now'];
  } else {
    const mins = Math.max(1, Math.ceil(delaySec / 60));
    if (delaySec < 60) {
      notes.push(`延遲 ${delaySec}s 會以最少 1 分鐘排程（shutdown +N 以分鐘計）`);
    }
    used = action === 'reboot' ? ['shutdown', '-r', `+${mins}`] : ['shutdown', '-h', `+${mins}`];
  }

  const r = await input.host.runCommand(used, { timeoutMs: 15_000 });
  const ok = r.exitCode === 0;
  const scheduledAt =
    delaySec > 0 ? new Date(Date.now() + Math.max(delaySec, 60) * 1000).toISOString() : new Date().toISOString();

  if (ok) {
    notes.push(
      action === 'reboot'
        ? delaySec === 0
          ? '已送出立即重啟指令'
          : `已排程重啟（約 ${Math.max(1, Math.ceil(delaySec / 60))} 分鐘後）`
        : delaySec === 0
          ? '已送出立即關機指令'
          : `已排程關機（約 ${Math.max(1, Math.ceil(delaySec / 60))} 分鐘後）`,
    );
    notes.push('面板連線即將中斷；可用「取消排程」撤回（若仍在線）');
  } else {
    notes.push(`電源指令失敗: ${(r.stderr || r.stdout || '').trim() || `exit ${r.exitCode}`}`);
  }

  return {
    ok,
    notes,
    action,
    delaySec,
    scheduledAt: ok ? scheduledAt : undefined,
    executeEnabled,
    isRoot,
  };
}
