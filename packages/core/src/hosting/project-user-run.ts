/**
 * Run project workloads as the project's Linux user (isolation).
 * Production (root + YSK_EXECUTE): hard-require os_provisioned; build/start via runuser.
 * Degraded: allow control-plane user with honest notes — never fake isolation.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { HostExecutor } from '../host/executor.js';
import type { ProjectRow } from '../repositories/project-repo.js';
import { ErrorCodes, YskError, tl} from 'ysk-server-shared';

export type IsolationMode = 'isolated' | 'degraded';

/**
 * When control plane is root+execute, deploy must have OS isolation.
 * Degraded mode does not throw (caller marks degraded).
 */
export function assertOsIsolationForDeploy(
  row: ProjectRow,
  host: HostExecutor,
  action = tl('notes.auto.n1497'),
): void {
  if (!host.executeEnabled() || !host.isRoot()) return;
  if (!row.os_provisioned) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      tl('notes.auto.t0141', { v0: (action) }) +
        tl('notes.auto.t0142', { v0: (row.id), v1: (row.linux_user) }),
      { httpStatus: 403, details: { projectId: row.id, linuxUser: row.linux_user } },
    );
  }
  if (!row.linux_user?.trim()) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0697'), { httpStatus: 400 });
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
    notes?.push(tl('notes.auto.n1254'));
    return { ok: false };
  }
  const home = row.home_dir;
  const u = row.linux_user;
  const g = row.linux_group || u;
  // Owner = project user; then re-apply ysk-web group bits so www-data/nginx can read public trees
  // (plain chown -R user:user would leave Apache/Nginx unable to read → 403/502 on PHP/static).
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      [
        `chown -R ${shellQuote(u)}:${shellQuote(g)} ${shellQuote(home)}`,
        `chmod 750 ${shellQuote(home)}`,
        `groupadd --system ysk-web 2>/dev/null || true`,
        `id www-data >/dev/null 2>&1 && usermod -aG ysk-web www-data 2>/dev/null || true`,
        `id nginx >/dev/null 2>&1 && usermod -aG ysk-web nginx 2>/dev/null || true`,
        `usermod -aG ysk-web ${shellQuote(u)} 2>/dev/null || true`,
        `chgrp ysk-web ${shellQuote(home)} 2>/dev/null || true`,
        `chmod 750 ${shellQuote(home)} 2>/dev/null || true`,
        `for d in app/public public app app/public/public_html; do`,
        `  p=${shellQuote(home)}/$d`,
        `  if [ -d "$p" ]; then chgrp -R ysk-web "$p" 2>/dev/null || true; chmod -R g+rX "$p" 2>/dev/null || true; fi`,
        `done`,
        // Roundcube/Snappy writable dirs (temp, logs, db) must be project-user writeable
        `for d in app/public/temp app/public/logs app/public/db app/public/public_html/temp; do`,
        `  p=${shellQuote(home)}/$d`,
        `  if [ -d "$p" ]; then chown -R ${shellQuote(u)}:${shellQuote(g)} "$p" 2>/dev/null || true; chmod -R ug+rwX "$p" 2>/dev/null || true; fi`,
        `done`,
        `if [ -f ${shellQuote(home)}/app/public/db/roundcube.db ]; then chown ${shellQuote(u)}:${shellQuote(g)} ${shellQuote(home)}/app/public/db/roundcube.db; chmod 664 ${shellQuote(home)}/app/public/db/roundcube.db; fi`,
      ].join('\n'),
    ],
    { timeoutMs: 60_000 },
  );
  if (r.exitCode === 0) {
    notes?.push(tl('notes.auto.t0143', { v0: (u), v1: (g), v2: (home) }));
    notes?.push('ysk-web group readability reapplied for public trees');
    return { ok: true };
  }
  notes?.push(tl('notes.tpl.chownFailed', { detail: (r.stderr || r.stdout || '').slice(0, 200) }));
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
    opts?.notes?.push(tl('notes.auto.t0144', { v0: (row.linux_user) }));
    return { ...r, mode };
  }
  opts?.notes?.push(tl('notes.auto.n0516'));
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
    input.notes?.push(tl('notes.auto.t0145', { v0: (input.row.linux_user) }));
    const child = spawn(
      'runuser',
      ['-u', input.row.linux_user, '--', 'bash', '-lc', input.shellCmd],
      opts,
    );
    return { child, mode };
  }
  input.notes?.push(tl('notes.auto.n0377'));
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
