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

export async function startVncSession(input: {
  host: HostExecutor;
  linuxUser: string;
  display: number;
  geometry: string;
  depth: number;
  rfbBind: VncRfbBind;
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

  const localhostFlag = rfbBind === 'localhost' ? 'yes' : 'no';
  // Prefer runuser; fall back to su -
  const inner = [
    `vncserver :${display}`,
    `-geometry ${shellQuote(geometry)}`,
    `-depth ${depth}`,
    `-localhost ${localhostFlag}`,
  ].join(' ');
  const script = `command -v vncserver >/dev/null 2>&1 || { echo 'vncserver missing'; exit 127; }; if command -v runuser >/dev/null 2>&1; then runuser -u ${shellQuote(linuxUser)} -- bash -lc ${shellQuote(inner)}; else su - ${shellQuote(linuxUser)} -c ${shellQuote(inner)}; fi`;

  const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 45_000 });
  if (r.exitCode !== 0) {
    notes.push(
      tl('notes.vnc.sessionStartFailed', {
        display: String(display),
        detail: (r.stderr || r.stdout || '').slice(0, 240),
      }),
    );
    return { ok: false, notes, running: false };
  }
  const running = await probeSessionRunning(host, display);
  notes.push(
    tl('notes.vnc.sessionStarted', {
      user: linuxUser,
      display: String(display),
      port: String(rfbPortForDisplay(display)),
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
  const inner = `vncserver -kill :${display} 2>/dev/null || true`;
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
