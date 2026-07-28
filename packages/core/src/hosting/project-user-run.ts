/**
 * Run project workloads as the project's Linux user (isolation).
 * Production (root + YSK_EXECUTE): hard-require os_provisioned; build/start via runuser.
 * Degraded: allow control-plane user with honest notes — never fake isolation.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { HostExecutor } from '../host/executor.js';
import type { ProjectRow } from '../repositories/project-repo.js';
import { ErrorCodes, YskError } from '@ysk/shared';

export type IsolationMode = 'isolated' | 'degraded';

/**
 * When control plane is root+execute, deploy must have OS isolation.
 * Degraded mode does not throw (caller marks degraded).
 */
export function assertOsIsolationForDeploy(
  row: ProjectRow,
  host: HostExecutor,
  action = '部署',
): void {
  if (!host.executeEnabled() || !host.isRoot()) return;
  if (!row.os_provisioned) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      `${action}前必須完成專案 Linux 用戶隔離（資源分頁 → 建立系統用戶）。` +
        ` 預期 home：/home/ysk-server-${row.id} · user：${row.linux_user}`,
      { httpStatus: 403, details: { projectId: row.id, linuxUser: row.linux_user } },
    );
  }
  if (!row.linux_user?.trim()) {
    throw new YskError(ErrorCodes.VALIDATION, '專案缺少 linux_user', { httpStatus: 400 });
  }
}

/** True when we can and should run as the project user. */
export function canRunAsProjectUser(row: ProjectRow, host: HostExecutor): boolean {
  return Boolean(
    host.executeEnabled() &&
      host.isRoot() &&
      row.os_provisioned &&
      row.linux_user?.trim(),
  );
}

export function isolationModeFor(row: ProjectRow, host: HostExecutor): IsolationMode {
  return canRunAsProjectUser(row, host) ? 'isolated' : 'degraded';
}

/**
 * chown -R project home to linux_user:linux_group (root only).
 */
export async function chownProjectHome(
  host: HostExecutor,
  row: ProjectRow,
  notes?: string[],
): Promise<{ ok: boolean }> {
  if (!canRunAsProjectUser(row, host)) {
    notes?.push('略過 chown（未以 root 隔離模式執行）');
    return { ok: false };
  }
  const home = row.home_dir;
  const u = row.linux_user;
  const g = row.linux_group || u;
  const r = await host.runCommand(
    ['bash', '-c', `chown -R ${shellQuote(u)}:${shellQuote(g)} ${shellQuote(home)} && chmod 750 ${shellQuote(home)}`],
    { timeoutMs: 60_000 },
  );
  if (r.exitCode === 0) {
    notes?.push(`已 chown ${u}:${g} → ${home}`);
    return { ok: true };
  }
  notes?.push(`chown 失敗：${(r.stderr || r.stdout || '').slice(0, 200)}`);
  return { ok: false };
}

/**
 * Run a shell command as project user when isolated; else as control-plane user.
 */
export async function runAsProjectUser(
  host: HostExecutor,
  row: ProjectRow,
  shellCmd: string,
  opts?: { timeoutMs?: number; cwd?: string; notes?: string[] },
): Promise<{ exitCode: number; stdout: string; stderr: string; mode: IsolationMode }> {
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const cwd = opts?.cwd ?? row.home_dir;
  const mode = isolationModeFor(row, host);
  if (mode === 'isolated') {
    const wrapped = `cd ${shellQuote(cwd)} && ${shellCmd}`;
    const r = await host.runCommand(
      ['runuser', '-u', row.linux_user, '--', 'bash', '-lc', wrapped],
      { timeoutMs },
    );
    opts?.notes?.push(`以專案用戶 ${row.linux_user} 執行指令`);
    return { ...r, mode };
  }
  opts?.notes?.push('以控制面用戶執行指令（degraded — 非專案 Linux 用戶）');
  const r = await host.runCommand(['bash', '-c', `cd ${shellQuote(cwd)} && ${shellCmd}`], {
    timeoutMs,
  });
  return { ...r, mode };
}

/**
 * Spawn detached process as project user when possible.
 * Prefer: runuser -u USER -- bash -lc '…'
 */
export function spawnAsProjectUser(input: {
  row: ProjectRow;
  host: HostExecutor;
  /** Shell body (already without outer bash -lc) */
  shellCmd: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logOutFd: number;
  logErrFd: number;
  notes?: string[];
}): { child: ChildProcess; mode: IsolationMode } {
  const mode = isolationModeFor(input.row, input.host);
  const opts: SpawnOptions = {
    cwd: input.cwd,
    env: input.env,
    detached: true,
    stdio: ['ignore', input.logOutFd, input.logErrFd],
  };
  if (mode === 'isolated') {
    input.notes?.push(`pidfile 以 runuser -u ${input.row.linux_user} 啟動`);
    const child = spawn(
      'runuser',
      ['-u', input.row.linux_user, '--', 'bash', '-lc', input.shellCmd],
      opts,
    );
    return { child, mode };
  }
  input.notes?.push('pidfile 以控制面用戶啟動（degraded）');
  const child = spawn('bash', ['-lc', input.shellCmd], opts);
  return { child, mode };
}

/** Shell single-quote escape */
export function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Live check: `id user` succeeds (optional strengthen provisioned flag).
 */
export async function linuxUserExists(
  host: HostExecutor,
  linuxUser: string,
): Promise<boolean> {
  const r = await host.runCommand(
    ['bash', '-c', `id ${shellQuote(linuxUser)} >/dev/null 2>&1; echo $?`],
    { timeoutMs: 5_000 },
  );
  const code = r.stdout.trim().split(/\n/).pop();
  return code === '0';
}
