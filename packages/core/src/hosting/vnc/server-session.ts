/**
 * Start / stop / probe TigerVNC sessions per Linux user + display.
 */

import type { HostExecutor } from '../../host/executor.js';
import { shellQuote } from '../project-user-run.js';
import { tl } from 'ysk-server-shared';
import { resolveBin } from '../software-probe/resolve-bin.js';
import type { VncRfbBind } from './types.js';
import { buildXstartup } from './xstartup.js';
import type { VncDesktopProfile } from './types.js';
import { rfbPortForDisplay } from './ports.js';

/** Same bin names SoftwareVersionBar / catalog use for TigerVNC server. */
export const VNCSERVER_BIN_CANDIDATES = [
  'tigervncserver',
  'vncserver',
] as const;

/** Absolute paths shipped by Ubuntu/Debian tigervnc-standalone-server. */
export const VNCSERVER_ABSOLUTE_PATHS = [
  '/usr/bin/tigervncserver',
  '/usr/bin/vncserver',
  '/usr/local/bin/tigervncserver',
  '/usr/local/bin/vncserver',
  '/bin/tigervncserver',
  '/bin/vncserver',
] as const;

const XSERVER_BINS = ['Xtigervnc', 'Xvnc', 'x0vncserver'] as const;
const XSERVER_ABS = [
  '/usr/bin/Xtigervnc',
  '/usr/bin/Xvnc',
  '/usr/bin/x0vncserver',
] as const;

async function hostFileExecutable(
  host: HostExecutor,
  path: string,
): Promise<boolean> {
  try {
    if (host.pathExists(path)) return true;
  } catch {
    /* */
  }
  // `test` is always allowed without YSK_EXECUTE (read-only simple bin)
  try {
    const r = await host.runCommand(['test', '-x', path], { timeoutMs: 3_000 });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Resolve absolute path to TigerVNC *wrapper* (tigervncserver / vncserver).
 * Prefer filesystem probes — do not depend on login-shell PATH.
 */
export async function resolveVncserverBin(
  host: HostExecutor,
): Promise<string | null> {
  // 1) Well-known absolute paths first (Ubuntu package layout)
  for (const p of VNCSERVER_ABSOLUTE_PATHS) {
    if (await hostFileExecutable(host, p)) return p;
  }
  // 2) Shared PATH probe (same as software catalog)
  for (const name of VNCSERVER_BIN_CANDIDATES) {
    const path = await resolveBin(host, name);
    if (path && (await hostFileExecutable(host, path))) return path;
  }
  // 3) dpkg file list when package is installed (dpkg-query is read-only allowlisted)
  try {
    const st = await host.runCommand(
      [
        'bash',
        '-c',
        "dpkg-query -W -f='${Status}' tigervnc-standalone-server 2>/dev/null || true",
      ],
      { timeoutMs: 5_000 },
    );
    if (/install ok installed/i.test(st.stdout || '')) {
      const list = await host.runCommand(
        [
          'bash',
          '-c',
          "dpkg-query -L tigervnc-standalone-server 2>/dev/null | grep -E '/(tigervncserver|vncserver)$' | head -1 || true",
        ],
        { timeoutMs: 5_000 },
      );
      const p = (list.stdout || '').trim().split('\n').filter(Boolean).pop();
      if (p && p.startsWith('/') && (await hostFileExecutable(host, p))) return p;
    }
  } catch {
    /* */
  }
  return null;
}

/** True if TigerVNC server stack is present (wrapper or X server binary). */
export async function isTigerVncInstalled(host: HostExecutor): Promise<{
  installed: boolean;
  serverBin: string | null;
  found: string[];
  packageInstalled: boolean;
}> {
  const found: string[] = [];
  const serverBin = await resolveVncserverBin(host);
  if (serverBin) found.push(serverBin);

  for (const p of XSERVER_ABS) {
    if (await hostFileExecutable(host, p)) found.push(p);
  }
  for (const name of XSERVER_BINS) {
    const p = await resolveBin(host, name);
    if (p && !found.includes(p)) found.push(p);
  }

  let packageInstalled = false;
  try {
    const r = await host.runCommand(
      [
        'bash',
        '-c',
        "dpkg-query -W -f='${Status}' tigervnc-standalone-server 2>/dev/null || true",
      ],
      { timeoutMs: 5_000 },
    );
    packageInstalled = /install ok installed/i.test(r.stdout || '');
  } catch {
    /* */
  }

  return {
    installed: Boolean(serverBin) || found.length > 0 || packageInstalled,
    serverBin,
    found,
    packageInstalled,
  };
}

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
    return { ok: false, notes };
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
    // Verify script is executable and non-empty (every host)
    `test -s ${shellQuote(path)} && test -x ${shellQuote(path)}`,
  ].join(' && ');
  const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 10_000 });
  if (r.exitCode !== 0) {
    notes.push(
      tl('notes.vnc.xstartupWriteFailed', {
        detail: (r.stderr || r.stdout || 'write failed').slice(0, 160),
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
  // Session script / desktop failures first (do NOT claim TigerVNC is missing)
  if (
    /xstartup|session startup via|x session exited|status 126|status 127/i.test(d) ||
    /exec:\s*\S+:\s*permission denied/i.test(d) ||
    /exec:\s*xterm/i.test(d)
  ) {
    return tl('notes.vnc.xstartupFailed', {
      display: String(input.display),
      detail: input.detail
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .find((l) => /xstartup|xterm|startxfce|permission|status/i.test(l))
        ?.slice(0, 140) || 'xstartup',
    });
  }
  if (/cannot stat initial working directory|initial working directory/i.test(d)) {
    return tl('notes.vnc.sessionStartCwd', { display: String(input.display) });
  }
  // Only when the wrapper binary itself is missing
  if (
    /vncserver missing/i.test(input.detail) ||
    (/\b(tigervncserver|vncserver)\b.*\b(not found|no such file)\b/i.test(input.detail) ||
      /\bcommand not found\b.*\b(tigervncserver|vncserver)\b/i.test(d))
  ) {
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

  const probe = await isTigerVncInstalled(host);
  let bin = probe.serverBin;
  // Last resort: package reports installed → use Debian/Ubuntu default path
  if (!bin && probe.packageInstalled) {
    for (const p of VNCSERVER_ABSOLUTE_PATHS) {
      if (await hostFileExecutable(host, p)) {
        bin = p;
        break;
      }
    }
    if (!bin) bin = '/usr/bin/tigervncserver';
  }
  if (!bin) {
    notes.push(tl('notes.vnc.vncserverMissing'));
    if (probe.found.length) {
      notes.push(
        tl('notes.vnc.vncserverWrapperMissing', {
          found: probe.found.map((p) => p.split('/').pop() || p).join(', '),
        }),
      );
    }
    if (probe.packageInstalled) {
      notes.push(tl('notes.vnc.vncPackageWithoutBin'));
    }
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
  // Absolute path + force HOME from passwd (never inherit control-plane cwd under /root)
  const inner = [
    `HOME=$(getent passwd ${shellQuote(linuxUser)} | cut -d: -f6)`,
    'HOME="${HOME:-/tmp}"',
    'export HOME',
    'cd "$HOME" || cd /tmp || true',
    'export USER=' + shellQuote(linuxUser),
    'export LOGNAME=' + shellQuote(linuxUser),
    [
      shellQuote(bin),
      `:${display}`,
      `-geometry ${geometry}`,
      `-depth ${depth}`,
      `-localhost ${localhostFlag}`,
    ].join(' '),
  ].join('; ');

  const runStart = async (): Promise<{ exitCode: number; detail: string }> => {
    // bash -c (not -lc): avoid profile; set HOME explicitly above
    const script = `if command -v runuser >/dev/null 2>&1; then runuser -u ${shellQuote(linuxUser)} -- bash -c ${shellQuote(inner)}; else su -s /bin/bash ${shellQuote(linuxUser)} -c ${shellQuote(inner)}; fi`;
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

  // Settle: X may bind RFB a moment after process fork (every host)
  let running = await probeSessionRunning(host, display);
  if (!running) {
    for (let i = 0; i < 8 && !running; i++) {
      await host.runCommand(['bash', '-c', 'sleep 0.35'], { timeoutMs: 2_000 });
      running = await probeSessionRunning(host, display);
    }
  }
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
