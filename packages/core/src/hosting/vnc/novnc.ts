/**
 * noVNC / websockify helpers — bind localhost RFB to a local HTTP port.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import { shellQuote } from '../project-user-run.js';
import { tl } from 'ysk-server-shared';
import { novncPortForDisplay, rfbPortForDisplay } from './ports.js';

export type NovncRuntime = {
  accountId: string;
  display: number;
  rfbPort: number;
  httpPort: number;
  pid?: number;
  startedAt: string;
};

export type ViewTicket = {
  token: string;
  accountId: string;
  expiresAt: number;
  httpPort: number;
};

function runtimePath(dataDir: string): string {
  return join(dataDir, 'vnc', 'novnc-runtime.json');
}

function ticketsPath(dataDir: string): string {
  return join(dataDir, 'vnc', 'view-tickets.json');
}

export function loadNovncRuntimes(dataDir: string): NovncRuntime[] {
  const p = runtimePath(dataDir);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { items?: NovncRuntime[] };
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

function saveNovncRuntimes(dataDir: string, items: NovncRuntime[]): void {
  mkdirSync(join(dataDir, 'vnc'), { recursive: true });
  writeFileSync(
    runtimePath(dataDir),
    JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}

function loadTickets(dataDir: string): ViewTicket[] {
  const p = ticketsPath(dataDir);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { items?: ViewTicket[] };
    const now = Date.now();
    return (Array.isArray(raw.items) ? raw.items : []).filter((t) => t.expiresAt > now);
  } catch {
    return [];
  }
}

function saveTickets(dataDir: string, items: ViewTicket[]): void {
  mkdirSync(join(dataDir, 'vnc'), { recursive: true });
  writeFileSync(
    ticketsPath(dataDir),
    JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}

export function isNovncRunning(dataDir: string, accountId: string): boolean {
  return loadNovncRuntimes(dataDir).some((r) => r.accountId === accountId);
}

export async function startNovnc(input: {
  host: HostExecutor;
  dataDir: string;
  accountId: string;
  display: number;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
  runtime?: NovncRuntime;
}> {
  const notes: string[] = [];
  const { host, dataDir, accountId, display } = input;
  if (!host.executeEnabled() || !host.isRoot()) {
    notes.push(tl('notes.vnc.novncStartBlocked'));
    return {
      ok: false,
      notes,
      blocked: true,
      requiresExecute: !host.executeEnabled(),
    };
  }

  const existing = loadNovncRuntimes(dataDir).find((r) => r.accountId === accountId);
  if (existing) {
    notes.push(tl('notes.vnc.novncAlreadyRunning', { port: String(existing.httpPort) }));
    return { ok: true, notes, runtime: existing };
  }

  const rfbPort = rfbPortForDisplay(display);
  const httpPort = novncPortForDisplay(display);
  const web =
    existsSync('/usr/share/novnc')
      ? '/usr/share/novnc'
      : existsSync('/usr/share/novnc/vnc.html')
        ? '/usr/share/novnc'
        : '';

  // websockify [options] [source_addr:]source_port target_addr:target_port
  // Prefer: websockify --web /usr/share/novnc 127.0.0.1:httpPort 127.0.0.1:rfbPort
  const webArg = web ? `--web ${shellQuote(web)}` : '';
  const script = [
    `command -v websockify >/dev/null 2>&1 || { echo 'websockify missing'; exit 127; }`,
    `nohup websockify ${webArg} 127.0.0.1:${httpPort} 127.0.0.1:${rfbPort} >/tmp/ysk-novnc-${display}.log 2>&1 & echo $!`,
  ].join(' && ');

  const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 15_000 });
  if (r.exitCode !== 0) {
    notes.push(
      tl('notes.vnc.novncStartFailed', {
        detail: (r.stderr || r.stdout || '').slice(0, 200),
      }),
    );
    return { ok: false, notes };
  }
  const pid = Number(r.stdout.trim().split('\n').pop()) || undefined;
  const runtime: NovncRuntime = {
    accountId,
    display,
    rfbPort,
    httpPort,
    pid,
    startedAt: new Date().toISOString(),
  };
  const items = loadNovncRuntimes(dataDir).filter((x) => x.accountId !== accountId);
  items.push(runtime);
  saveNovncRuntimes(dataDir, items);
  notes.push(
    tl('notes.vnc.novncStarted', {
      httpPort: String(httpPort),
      rfbPort: String(rfbPort),
    }),
  );
  return { ok: true, notes, runtime };
}

export async function stopNovnc(input: {
  host: HostExecutor;
  dataDir: string;
  accountId: string;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
}> {
  const notes: string[] = [];
  const { host, dataDir, accountId } = input;
  const items = loadNovncRuntimes(dataDir);
  const rt = items.find((r) => r.accountId === accountId);
  if (!rt) {
    notes.push(tl('notes.vnc.novncNotRunning'));
    return { ok: true, notes };
  }
  if (!host.executeEnabled() || !host.isRoot()) {
    notes.push(tl('notes.vnc.novncStopBlocked'));
    return {
      ok: false,
      notes,
      blocked: true,
      requiresExecute: !host.executeEnabled(),
    };
  }
  if (rt.pid) {
    await host.runCommand(['bash', '-c', `kill ${rt.pid} 2>/dev/null || true`], {
      timeoutMs: 5_000,
    });
  }
  await host.runCommand(
    [
      'bash',
      '-c',
      `pkill -f 'websockify.*${rt.httpPort}' 2>/dev/null || true`,
    ],
    { timeoutMs: 5_000 },
  );
  saveNovncRuntimes(
    dataDir,
    items.filter((r) => r.accountId !== accountId),
  );
  notes.push(tl('notes.vnc.novncStopped', { httpPort: String(rt.httpPort) }));
  return { ok: true, notes };
}

export function createViewTicket(input: {
  dataDir: string;
  accountId: string;
  httpPort: number;
  ttlMs?: number;
}): ViewTicket {
  const token = randomBytes(24).toString('hex');
  const ticket: ViewTicket = {
    token,
    accountId: input.accountId,
    httpPort: input.httpPort,
    expiresAt: Date.now() + (input.ttlMs ?? 10 * 60_000),
  };
  const items = loadTickets(input.dataDir).filter((t) => t.accountId !== input.accountId);
  items.push(ticket);
  saveTickets(input.dataDir, items);
  return ticket;
}

export function consumeViewTicket(
  dataDir: string,
  token: string,
): ViewTicket | null {
  const items = loadTickets(dataDir);
  const t = items.find((x) => x.token === token);
  if (!t || t.expiresAt <= Date.now()) return null;
  return t;
}

export function buildConnectionPayload(input: {
  accountId: string;
  name: string;
  linuxUser: string;
  display: number;
  rfbPort: number;
  rfbBind: 'localhost' | 'all';
  endpointHint: string | null;
  novncHttpPort?: number | null;
  viewTicketToken?: string | null;
}): {
  direct: {
    host: string;
    port: number;
    display: number;
    address: string;
    bind: string;
    recommended: boolean;
    notes: string[];
  };
  viaServer: {
    available: boolean;
    httpPort: number | null;
    localUrl: string | null;
    ticketPath: string | null;
    recommended: boolean;
    notes: string[];
  };
} {
  const host = input.endpointHint || '127.0.0.1';
  const directNotes: string[] = [];
  if (input.rfbBind === 'localhost') {
    directNotes.push(tl('notes.vnc.directNeedsAllBind'));
  } else {
    // Host firewall is auto-synced on start (ysk-svc:vnc:…); UI shows access strip
    directNotes.push(tl('notes.vnc.directOpenFirewall', { port: String(input.rfbPort) }));
  }

  const httpPort = input.novncHttpPort ?? null;
  const viaAvailable = httpPort != null;
  const localUrl = viaAvailable
    ? `http://127.0.0.1:${httpPort}/vnc.html?host=127.0.0.1&port=${httpPort}`
    : null;
  const ticketPath = input.viewTicketToken
    ? `/api/v1/vnc/view/${input.viewTicketToken}`
    : null;

  return {
    direct: {
      host,
      port: input.rfbPort,
      display: input.display,
      address: `${host}:${input.rfbPort}`,
      bind: input.rfbBind,
      recommended: false,
      notes: directNotes,
    },
    viaServer: {
      available: viaAvailable,
      httpPort,
      localUrl,
      ticketPath,
      recommended: true,
      notes: viaAvailable
        ? [tl('notes.vnc.viaServerReady')]
        : [tl('notes.vnc.viaServerStartFirst')],
    },
  };
}

export async function openUfwTcpPort(input: {
  host: HostExecutor;
  port: number;
  comment?: string;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
}> {
  const notes: string[] = [];
  const port = input.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    notes.push(tl('notes.vnc.invalidPort'));
    return { ok: false, notes };
  }
  if (!input.host.executeEnabled()) {
    notes.push(tl('notes.vnc.firewallNeedExecute'));
    return { ok: false, notes, blocked: true, requiresExecute: true };
  }
  if (!input.host.isRoot()) {
    notes.push(tl('notes.vnc.firewallNeedRoot'));
    return { ok: false, notes, blocked: true };
  }
  const comment = input.comment ?? 'ysk-svc:vnc:listen';
  // Prefer shared UFW helper (comment-tagged, honest blocked)
  const { firewallAllowPort } = await import('../firewall-ops.js');
  const r = await firewallAllowPort(input.host, port, 'tcp', undefined, comment);
  if (!r.ok) {
    notes.push(
      ...(r.notes?.length
        ? r.notes
        : [
            tl('notes.vnc.firewallFailed', {
              detail: 'ufw allow failed',
            }),
          ]),
    );
    return { ok: false, notes, blocked: r.blocked, requiresExecute: r.blocked };
  }
  notes.push(...(r.notes ?? []), tl('notes.vnc.firewallOpened', { port: String(port) }));
  return { ok: true, notes, blocked: r.blocked };
}
