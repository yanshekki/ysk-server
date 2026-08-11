/**
 * Start / stop / probe TigerVNC sessions per Linux user + display.
 */

import type { HostExecutor } from '../../host/executor.js';
import { shellQuote } from '../project-user-run.js';
import { tl } from '@ysk/shared';
import type { VncRfbBind } from './types.js';
import { buildXstartup } from './xstartup.js';
import type { VncDesktopProfile } from './types.js';
import { rfbPortForDisplay } from './ports.js';

export async function writeXstartupFile(input: {
  host: HostExecutor;
  linuxUser: string;
  home: string;
  desktop: VncDesktopProfile;
}): Promise<{ ok: boolean; notes: string[]; path?: string }> {
  const notes: string[] = [];
  const { host, linuxUser, home, desktop } = input;
  if (!host.executeEnabled() || !host.isRoot()) {
    notes.push(tl('notes.vnc.xstartupWrittenOnly'));
    return { ok: true, notes };
  }
  const body = buildXstartup(desktop);
  const path = `${home.replace(/\/$/, '')}/.vnc/xstartup`;
  // Write via base64 to avoid shell quoting hell
  const b64 = Buffer.from(body, 'utf8').toString('base64');
  const script = [
    `mkdir -p ${shellQuote(home + '/.vnc')}`,
    `echo ${shellQuote(b64)} | base64 -d > ${shellQuote(path)}`,
    `chmod 755 ${shellQuote(path)}`,
    `chown -R ${shellQuote(linuxUser)}:${shellQuote(linuxUser)} ${shellQuote(home + '/.vnc')}`,
  ].join(' && ');
  const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 10_000 });
  if (r.exitCode !== 0) {
    notes.push(
      tl('notes.vnc.xstartupFailed', {
        detail: (r.stderr || r.stdout || '').slice(0, 160),
      }),
    );
    return { ok: false, notes };
  }
  notes.push(tl('notes.vnc.xstartupWritten', { path }));
  return { ok: true, notes, path };
}

export async function probeSessionRunning(
  host: HostExecutor,
  display: number,
): Promise<boolean> {
  const port = rfbPortForDisplay(display);
  try {
    const r = await host.runCommand(
      [
        'bash',
        '-c',
        `ss -lnt 2>/dev/null | grep -E ':${port}\\s' >/dev/null && echo up || true`,
      ],
      { timeoutMs: 8_000 },
    );
    return r.stdout.includes('up');
  } catch {
    return false;
  }
}

async function resolveVncserverBin(host: HostExecutor): Promise<string | null> {
  try {
    const r = await host.runCommand(
      [
        'bash',
        '-c',
        `command -v vncserver 2>/dev/null || command -v tigervncserver 2>/dev/null || true`,
      ],
      { timeoutMs: 5_000 },
    );
    const bin = (r.stdout || '').trim().split('\n')[0]?.trim();
    return bin || null;
  } catch {
    return null;
  }
}

async function passwdFileExists(
  host: HostExecutor,
  home: string,
): Promise<boolean> {
  const path = `${home.replace(/\/$/, '')}/.vnc/passwd`;
  try {
    const r = await host.runCommand(
      ['bash', '-c', `test -s ${shellQuote(path)} && echo yes || echo no`],
      { timeoutMs: 5_000 },
    );
    return r.stdout.includes('yes');
  } catch {
    return false;
  }
}

/** Map raw vncserver stderr to a short operator-facing note (primary, no path dump). */
export function classifyVncStartFailure(input: {
  display: number;
  port: number;
  detail: string;
}): string {
  const d = input.detail.toLowerCase();
  if (/vncserver missing|not found|no such file/i.test(input.detail) || d.includes('command not found')) {
    return tl('notes.vnc.vncserverMissing');
  }
  if (
    /password|passwd|authentication|no password configured|you will require a password/i.test(
      d,
    )
  ) {
    return tl('notes.vnc.needPasswordBeforeStart');
  }
  if (
    /already running|in use|address already in use|bind: address|port.*busy|A VNC server is already running/i.test(
      d,
    )
  ) {
    return tl('notes.vnc.displayPortBusy', {
      display: String(input.display),
      port: String(input.port),
    });
  }
  if (/permission denied|cannot open|not permitted/i.test(d)) {
    return tl('notes.vnc.sessionStartPermission', {
      display: String(input.display),
    });
  }
  // Keep short: prefer first line of detail without flooding UI
  const short = input.detail
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0]
    ?.slice(0, 160);
  return tl('notes.vnc.sessionStartFailed', {
    display: String(input.display),
    detail: short || 'unknown error',
  });
}

/**
 * Clear stale X/VNC locks for display when port is not listening (same user).
 * Best-effort; does not kill foreign processes on a live port.
 */
async function clearStaleDisplayLocks(input: {
  host: HostExecutor;
  linuxUser: string;
  home: string;
  display: number;
}): Promise<void> {
  const { host, linuxUser, home, display } = input;
  const vncDir = `${home.replace(/\/$/, '')}/.vnc`;
  const script = [
    `rm -f ${shellQuote(`/tmp/.X${display}-lock`)} 2>/dev/null || true`,
    `rm -f ${shellQuote(`/tmp/.X11-unix/X${display}`)} 2>/dev/null || true`,
    `rm -f ${shellQuote(`${vncDir}/*:${display}.pid`)} 2>/dev/null || true`,
    `rm -f ${shellQuote(`${vncDir}/*:${display}.log`)} 2>/dev/null || true`,
    // Best-effort kill only if owned by target user and display matches
    `pkill -u ${shellQuote(linuxUser)} -f ${shellQuote(`[X]vnc :${display}`)} 2>/dev/null || true`,
  ].join('; ');
  await host.runCommand(['bash', '-c', script], { timeoutMs: 10_000 });
}

export async function startVncSession(input: {
  host: HostExecutor;
  linuxUser: string;
  display: number;
  geometry: string;
  depth: number;
  rfbBind: VncRfbBind;
  /** Home directory (default /home/{linuxUser}) */
  home?: string;
  /** If control-plane says no password, fail early when file also missing */
  requirePassword?: boolean;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  running?: boolean;
}> {
  const notes: string[] = [];
  const { host, linuxUser, display, geometry, depth, rfbBind } = input;
  const home = input.home ?? `/home/${linuxUser}`;
  const port = rfbPortForDisplay(display);

  if (!host.executeEnabled() || !host.isRoot()) {
    notes.push(tl('notes.vnc.sessionStartBlocked'));
    return {
      ok: false,
      notes,
      blocked: true,
      requiresExecute: !host.executeEnabled(),
      requiresRoot: !host.isRoot(),
    };
  }

  const bin = await resolveVncserverBin(host);
  if (!bin) {
    notes.push(tl('notes.vnc.vncserverMissing'));
    return { ok: false, notes, running: false };
  }

  const hasPasswd = await passwdFileExists(host, home);
  if (!hasPasswd) {
    notes.push(tl('notes.vnc.needPasswordBeforeStart'));
    return { ok: false, notes, running: false };
  }

  // Already listening → treat as success (idempotent start)
  if (await probeSessionRunning(host, display)) {
    notes.push(
      tl('notes.vnc.sessionAlreadyRunning', {
        user: linuxUser,
        display: String(display),
        port: String(port),
      }),
    );
    return { ok: true, notes, running: true };
  }

  const localhostFlag = rfbBind === 'localhost' ? 'yes' : 'no';
  const vncName = bin.includes('tigervncserver') ? 'tigervncserver' : 'vncserver';
  const inner = [
    `${vncName} :${display}`,
    `-geometry ${shellQuote(geometry)}`,
    `-depth ${depth}`,
    `-localhost ${localhostFlag}`,
  ].join(' ');

  const runStart = async (): Promise<{ exitCode: number; detail: string }> => {
    const script = `if command -v runuser >/dev/null 2>&1; then runuser -u ${shellQuote(linuxUser)} -- bash -lc ${shellQuote(inner)}; else su - ${shellQuote(linuxUser)} -c ${shellQuote(inner)}; fi`;
    const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 45_000 });
    return {
      exitCode: r.exitCode,
      detail: (r.stderr || r.stdout || '').trim(),
    };
  };

  let result = await runStart();

  // Stale lock / "already running" but port down → clear locks and retry once
  if (
    result.exitCode !== 0 &&
    /already running|in use|A VNC server is already running/i.test(result.detail) &&
    !(await probeSessionRunning(host, display))
  ) {
    await clearStaleDisplayLocks({ host, linuxUser, home, display });
    notes.push(tl('notes.vnc.staleLockCleared', { display: String(display) }));
    result = await runStart();
  }

  if (result.exitCode !== 0) {
    // Port became busy after failed start → clear conflict message
    if (await probeSessionRunning(host, display)) {
      notes.push(
        tl('notes.vnc.sessionAlreadyRunning', {
          user: linuxUser,
          display: String(display),
          port: String(port),
        }),
      );
      return { ok: true, notes, running: true };
    }
    notes.push(
      classifyVncStartFailure({
        display,
        port,
        detail: result.detail || 'vncserver exited non-zero',
      }),
    );
    return { ok: false, notes, running: false };
  }

  // Brief settle for RFB bind
  const running = await probeSessionRunning(host, display);
  notes.push(
    tl('notes.vnc.sessionStarted', {
      user: linuxUser,
      display: String(display),
      port: String(port),
    }),
  );
  if (!running) {
    notes.push(tl('notes.vnc.sessionStartUnverified'));
  }
  return { ok: true, notes, running };
}

export async function stopVncSession(input: {
  host: HostExecutor;
  linuxUser: string;
  display: number;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
}> {
  const notes: string[] = [];
  const { host, linuxUser, display } = input;
  if (!host.executeEnabled() || !host.isRoot()) {
    notes.push(tl('notes.vnc.sessionStopBlocked'));
    return {
      ok: false,
      notes,
      blocked: true,
      requiresExecute: !host.executeEnabled(),
    };
  }
  const inner = `vncserver -kill :${display} 2>/dev/null || tigervncserver -kill :${display} 2>/dev/null || true`;
  const script = `if command -v runuser >/dev/null 2>&1; then runuser -u ${shellQuote(linuxUser)} -- bash -lc ${shellQuote(inner)}; else su - ${shellQuote(linuxUser)} -c ${shellQuote(inner)}; fi`;
  await host.runCommand(['bash', '-c', script], { timeoutMs: 20_000 });
  // Also pkill leftover Xvnc for this display best-effort
  await host.runCommand(
    [
      'bash',
      '-c',
      `pkill -f '[X]vnc :${display}' 2>/dev/null || pkill -f 'Xvnc.*:${display}' 2>/dev/null || true`,
    ],
    { timeoutMs: 8_000 },
  );
  notes.push(
    tl('notes.vnc.sessionStopped', {
      user: linuxUser,
      display: String(display),
    }),
  );
  return { ok: true, notes };
}
