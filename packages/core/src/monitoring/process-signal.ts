import { tl } from '@ysk-server/shared';
/**
 * Send signals to host processes (kill) — honest, fail-closed without YSK_EXECUTE.
 * Never pretends success; never signals PID 1 without refusal.
 */

import type { HostExecutor } from '../host/executor.js';

export type ProcessSignal = 'TERM' | 'KILL' | 'HUP' | 'USR1';

export const PROCESS_SIGNALS: readonly ProcessSignal[] = [
  'TERM',
  'KILL',
  'HUP',
  'USR1',
] as const;

export type SignalProcessResult = {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  pid: string;
  signal: ProcessSignal;
  /** After signal: kill -0 still succeeds → still alive */
  stillAlive?: boolean;
  /** /proc cmdline snippet when readable */
  command?: string;
  notes: string[];
  executeEnabled?: boolean;
};

const SIG_NAME: Record<ProcessSignal, string> = {
  TERM: 'SIGTERM',
  KILL: 'SIGKILL',
  HUP: 'SIGHUP',
  USR1: 'SIGUSR1',
};

export function isProcessSignal(v: unknown): v is ProcessSignal {
  return typeof v === 'string' && (PROCESS_SIGNALS as readonly string[]).includes(v);
}

/**
 * Normalize and validate PID string. Returns null if invalid / protected init.
 */
export function normalizePid(raw: string | number): { ok: true; pid: string } | { ok: false; reason: string } {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) {
    return { ok: false, reason: tl('notes.auto.n0149') };
  }
  // no leading zeros abuse; allow "01" → treat as number
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1) {
    return { ok: false, reason: tl('notes.auto.n0150') };
  }
  if (n === 1) {
    return { ok: false, reason: tl('notes.auto.n0875') };
  }
  return { ok: true, pid: String(n) };
}

function looksLikeControlPlane(cmd: string): boolean {
  const c = cmd.toLowerCase();
  return (
    c.includes('ysk-server') ||
    c.includes('ysk-server') ||
    /\/ysk-server(\s|$)/.test(c) ||
    /node.*apps\/server/.test(c)
  );
}

/**
 * Read process cmdline via host (honest empty when unreadable).
 */
export async function readProcessCmdline(
  host: HostExecutor,
  pid: string,
): Promise<string | undefined> {
  const r = await host.runCommand(
    ['bash', '-c', `tr '\\0' ' ' < /proc/${pid}/cmdline 2>/dev/null | head -c 400`],
    { timeoutMs: 3_000 },
  );
  if (r.exitCode !== 0) return undefined;
  const t = r.stdout.trim();
  return t || undefined;
}

/**
 * Lightweight /proc detail for drawer.
 */
export async function collectProcessDetail(
  host: HostExecutor,
  pidRaw: string,
): Promise<{
  ok: boolean;
  pid: string;
  command?: string;
  cwd?: string;
  fdCount?: number;
  notes: string[];
}> {
  const norm = normalizePid(pidRaw);
  if (!norm.ok) {
    return { ok: false, pid: String(pidRaw), notes: [norm.reason] };
  }
  const pid = norm.pid;
  const notes: string[] = [];
  const command = await readProcessCmdline(host, pid);
  if (!command) notes.push(tl('notes.auto.n1183'));

  let cwd: string | undefined;
  const cwdR = await host.runCommand(
    ['bash', '-c', `readlink /proc/${pid}/cwd 2>/dev/null`],
    { timeoutMs: 3_000 },
  );
  if (cwdR.exitCode === 0 && cwdR.stdout.trim()) {
    cwd = cwdR.stdout.trim();
  } else {
    notes.push(tl('notes.auto.n0242'));
  }

  let fdCount: number | undefined;
  const fdR = await host.runCommand(
    ['bash', '-c', `ls /proc/${pid}/fd 2>/dev/null | wc -l`],
    { timeoutMs: 3_000 },
  );
  if (fdR.exitCode === 0) {
    const n = Number(fdR.stdout.trim());
    if (Number.isFinite(n)) fdCount = n;
  } else {
    notes.push(tl('notes.auto.n0289'));
  }

  return {
    ok: Boolean(command || cwd || fdCount != null),
    pid,
    command,
    cwd,
    fdCount,
    notes,
  };
}

export type ReniceResult = {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  pid: string;
  nice?: number;
  notes: string[];
  executeEnabled?: boolean;
};

/**
 * Adjust process nice value (-20..19). Requires YSK_EXECUTE.
 * Uses `renice -n N -p PID` (relative) when absolute not available we use absolute via renice.
 */
export async function reniceProcess(input: {
  host: HostExecutor;
  pid: string | number;
  /** Absolute nice value -20..19 */
  nice: number;
}): Promise<ReniceResult> {
  const notes: string[] = [];
  const executeEnabled = input.host.executeEnabled();
  const norm = normalizePid(input.pid);
  if (!norm.ok) {
    return {
      ok: false,
      pid: String(input.pid),
      notes: [norm.reason],
      executeEnabled,
    };
  }
  const pid = norm.pid;
  const nice = Math.floor(Number(input.nice));
  if (!Number.isFinite(nice) || nice < -20 || nice > 19) {
    return {
      ok: false,
      pid,
      notes: [tl('notes.auto.n0345')],
      executeEnabled,
    };
  }
  if (Number(pid) === process.pid) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('notes.auto.n0870'),
      pid,
      notes: [tl('notes.auto.n0557')],
      executeEnabled,
    };
  }
  if (!executeEnabled) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('ops.blocked.renice'),
      pid,
      notes: [tl('ops.blocked.needExecuteYsk')],
      executeEnabled,
    };
  }

  // renice -n sets absolute on many systems when used as `renice N -p PID`
  const r = await input.host.runCommand(
    ['renice', String(nice), '-p', pid],
    { timeoutMs: 5_000 },
  );
  if (r.exitCode !== 0) {
    return {
      ok: false,
      pid,
      nice,
      notes: [
        tl('notes.tpl.reniceFailed', { detail: (r.stderr || r.stdout || '').trim().slice(0, 200) || `exit ${r.exitCode}` }),
      ],
      executeEnabled,
    };
  }
  notes.push(`PID ${pid} nice → ${nice}`);
  // verify via ps
  const ps = await input.host.runCommand(
    ['ps', '-o', 'ni=', '-p', pid],
    { timeoutMs: 3_000 },
  );
  if (ps.exitCode === 0 && ps.stdout.trim()) {
    notes.push(tl('notes.auto.t0440', { v0: (ps.stdout.trim()) }));
  }
  return { ok: true, pid, nice, notes, executeEnabled };
}

export async function signalProcess(input: {
  host: HostExecutor;
  pid: string | number;
  signal: ProcessSignal;
  /** Allow signaling this Node process (ysk-server itself) */
  forceSelf?: boolean;
  /**
   * When true, allow signaling a process whose cmdline looks like ysk control plane
   * (even if not process.pid). Default false.
   */
  forceControlPlane?: boolean;
}): Promise<SignalProcessResult> {
  const notes: string[] = [];
  const executeEnabled = input.host.executeEnabled();
  const signal = input.signal;

  if (!isProcessSignal(signal)) {
    return {
      ok: false,
      pid: String(input.pid),
      signal: 'TERM',
      notes: [tl('notes.auto.n0498')],
      executeEnabled,
    };
  }

  const norm = normalizePid(input.pid);
  if (!norm.ok) {
    return {
      ok: false,
      pid: String(input.pid),
      signal,
      notes: [norm.reason],
      executeEnabled,
    };
  }
  const pid = norm.pid;

  // Self-protect
  if (Number(pid) === process.pid && !input.forceSelf) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('notes.auto.n0877'),
      pid,
      signal,
      notes: [tl('notes.auto.t0441', { v0: (pid) })],
      executeEnabled,
      command: process.argv.join(' ').slice(0, 200),
    };
  }

  let command = await readProcessCmdline(input.host, pid);
  if (command) {
    notes.push(`cmdline: ${command.slice(0, 160)}`);
  }

  if (
    command &&
    looksLikeControlPlane(command) &&
    Number(pid) !== process.pid &&
    !input.forceControlPlane &&
    !input.forceSelf
  ) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('notes.auto.n0876'),
      pid,
      signal,
      notes: [...notes, tl('notes.auto.n0240')],
      executeEnabled,
      command,
    };
  }

  if (!executeEnabled) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('ops.blocked.signal'),
      pid,
      signal,
      notes: [...notes, tl('ops.blocked.signalNote')],
      executeEnabled,
      command,
    };
  }

  // Existence check first
  const probe0 = await input.host.runCommand(['kill', '-0', pid], { timeoutMs: 3_000 });
  if (probe0.exitCode !== 0) {
    notes.push(tl('notes.auto.t0442', { v0: (probe0.exitCode) }));
    return {
      ok: false,
      pid,
      signal,
      stillAlive: false,
      notes: [
        ...notes,
        (probe0.stderr || probe0.stdout || '').trim().slice(0, 160) || tl('notes.auto.n0316'),
      ],
      executeEnabled,
      command,
    };
  }

  const sigName = SIG_NAME[signal];
  const killR = await input.host.runCommand(['kill', '-s', sigName, pid], {
    timeoutMs: 5_000,
  });
  if (killR.exitCode !== 0) {
    const err = (killR.stderr || killR.stdout || '').trim().slice(0, 200);
    notes.push(tl('notes.tpl.killFailed', { sig: sigName, detail: err || `exit ${killR.exitCode}` }));
    // still probe
    const still = await input.host.runCommand(['kill', '-0', pid], { timeoutMs: 3_000 });
    return {
      ok: false,
      pid,
      signal,
      stillAlive: still.exitCode === 0,
      notes,
      executeEnabled,
      command,
    };
  }

  notes.push(tl('notes.auto.t0444', { v0: (sigName), v1: (pid) }));

  // Brief settle for TERM
  if (signal === 'TERM') {
    await new Promise((r) => setTimeout(r, 120));
  }

  const still = await input.host.runCommand(['kill', '-0', pid], { timeoutMs: 3_000 });
  const stillAlive = still.exitCode === 0;
  if (stillAlive) {
    notes.push(
      signal === 'KILL'
        ? tl('notes.auto.n0315')
        : tl('notes.auto.n1469'),
    );
  } else {
    notes.push(tl('notes.auto.n1470'));
  }

  return {
    ok: true,
    pid,
    signal,
    stillAlive,
    notes,
    executeEnabled,
    command,
  };
}
