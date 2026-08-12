import { tl } from '@ysk-server/shared';
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
      notes: [tl('notes.auto.n0970')],
      action: action as HostPowerAction,
      executeEnabled,
      isRoot,
    };
  }

  if (!executeEnabled || !isRoot) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('notes.auto.n1159'),
      notes: [tl('ops.blocked.needExecuteRoot')],
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
        ? tl('notes.auto.n0742')
        : tl('notes.tpl.cancelFailed', { detail: (r.stderr || r.stdout || '').trim() || `exit ${r.exitCode}` }),
    );
    return { ok, notes, action, executeEnabled, isRoot };
  }

  const need = CONFIRM[action];
  if ((input.confirm ?? '').trim() !== need) {
    return {
      ok: false,
      notes: [tl('notes.auto.t0101', { v0: (need) })],
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
      notes.push(tl('notes.auto.t0102', { v0: (delaySec) }));
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
          ? tl('notes.auto.n0802')
          : tl('notes.auto.t0103', { v0: (Math.max(1, Math.ceil(delaySec / 60))) })
        : delaySec === 0
          ? tl('notes.auto.n0803')
          : tl('notes.auto.t0104', { v0: (Math.max(1, Math.ceil(delaySec / 60))) }),
    );
    notes.push(tl('notes.auto.n1594'));
  } else {
    notes.push(tl('notes.tpl.powerCmdFailed', { detail: (r.stderr || r.stdout || '').trim() || `exit ${r.exitCode}` }));
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
