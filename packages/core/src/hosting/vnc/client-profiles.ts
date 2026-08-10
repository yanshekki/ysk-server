/**
 * Outbound VNC client profiles — via_server (noVNC proxy) or direct vncviewer.
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import { shellQuote } from '../project-user-run.js';
import { ErrorCodes, YskError, tl } from '@ysk/shared';
import type { VncClientProfile, VncConnectPath } from './types.js';
import { novncPortForDisplay } from './ports.js';

export type VncClientRecord = {
  id: string;
  name: string;
  host: string;
  port: number;
  path: VncConnectPath;
  /** Optional password stored only when user opted in; prefer empty */
  password?: string;
  autostart: boolean;
  status: 'up' | 'down' | 'unknown' | 'error';
  pid?: number;
  localHttpPort?: number;
  createdAt: string;
  updatedAt: string;
};

function clientDir(dataDir: string): string {
  return join(dataDir, 'vnc', 'client', 'profiles');
}

function indexPath(dataDir: string): string {
  return join(clientDir(dataDir), 'index.json');
}

export function loadClientProfiles(dataDir: string): VncClientRecord[] {
  const p = indexPath(dataDir);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { items?: VncClientRecord[] };
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

function saveClientProfiles(dataDir: string, items: VncClientRecord[]): void {
  mkdirSync(clientDir(dataDir), { recursive: true });
  writeFileSync(
    indexPath(dataDir),
    JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}

function toPublic(r: VncClientRecord): VncClientProfile {
  return {
    id: r.id,
    name: r.name,
    host: r.host,
    port: r.port,
    path: r.path,
    status: r.status,
    autostart: r.autostart,
    createdAt: r.createdAt,
  };
}

export function listClientProfilesPublic(dataDir: string): VncClientProfile[] {
  return loadClientProfiles(dataDir).map(toPublic);
}

export function createClientProfile(
  dataDir: string,
  input: {
    name: string;
    host: string;
    port: number;
    path?: VncConnectPath;
    password?: string;
    autostart?: boolean;
  },
): VncClientProfile {
  const name = String(input.name ?? '').trim();
  const host = String(input.host ?? '').trim();
  const port = Number(input.port);
  if (!name || !host) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.vnc.clientInvalid'), {
      httpStatus: 400,
    });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.vnc.invalidPort'), {
      httpStatus: 400,
    });
  }
  const items = loadClientProfiles(dataDir);
  const now = new Date().toISOString();
  const rec: VncClientRecord = {
    id: randomUUID(),
    name,
    host,
    port,
    path: input.path === 'direct' ? 'direct' : 'via_server',
    password: input.password || undefined,
    autostart: Boolean(input.autostart),
    status: 'down',
    createdAt: now,
    updatedAt: now,
  };
  items.unshift(rec);
  saveClientProfiles(dataDir, items);
  return toPublic(rec);
}

export function updateClientProfile(
  dataDir: string,
  id: string,
  patch: {
    name?: string;
    host?: string;
    port?: number;
    path?: VncConnectPath;
    autostart?: boolean;
    password?: string | null;
  },
): VncClientProfile {
  const items = loadClientProfiles(dataDir);
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.vnc.clientNotFound'), {
      httpStatus: 404,
    });
  }
  const rec = { ...items[idx] };
  if (patch.name != null) rec.name = String(patch.name).trim() || rec.name;
  if (patch.host != null) rec.host = String(patch.host).trim() || rec.host;
  if (patch.port != null) {
    const port = Number(patch.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.vnc.invalidPort'), {
        httpStatus: 400,
      });
    }
    rec.port = port;
  }
  if (patch.path === 'direct' || patch.path === 'via_server') rec.path = patch.path;
  if (typeof patch.autostart === 'boolean') rec.autostart = patch.autostart;
  if (patch.password === null) delete rec.password;
  else if (typeof patch.password === 'string' && patch.password) {
    rec.password = patch.password;
  }
  rec.updatedAt = new Date().toISOString();
  items[idx] = rec;
  saveClientProfiles(dataDir, items);
  return toPublic(rec);
}

export async function clientUp(input: {
  host: HostExecutor;
  dataDir: string;
  id: string;
  path?: VncConnectPath;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
  profile?: VncClientProfile;
}> {
  const notes: string[] = [];
  const items = loadClientProfiles(input.dataDir);
  const idx = items.findIndex((x) => x.id === input.id);
  if (idx < 0) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.vnc.clientNotFound'), {
      httpStatus: 404,
    });
  }
  const rec = { ...items[idx] };
  const pathMode = input.path ?? rec.path;

  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    notes.push(tl('notes.vnc.clientUpBlocked'));
    return {
      ok: false,
      notes,
      blocked: true,
      requiresExecute: !input.host.executeEnabled(),
      profile: toPublic(rec),
    };
  }

  if (pathMode === 'via_server') {
    // Pick a free-ish local noVNC port from a high range keyed by id hash
    const localHttp =
      rec.localHttpPort ??
      6100 + (parseInt(rec.id.replace(/\D/g, '').slice(0, 4) || '1', 10) % 500);
    const web = existsSync('/usr/share/novnc') ? '--web /usr/share/novnc' : '';
    const script = [
      `command -v websockify >/dev/null 2>&1 || { echo 'websockify missing'; exit 127; }`,
      `nohup websockify ${web} 127.0.0.1:${localHttp} ${shellQuote(rec.host)}:${rec.port} >/tmp/ysk-vnc-client-${rec.id.slice(0, 8)}.log 2>&1 & echo $!`,
    ].join(' && ');
    const r = await input.host.runCommand(['bash', '-c', script], {
      timeoutMs: 15_000,
    });
    if (r.exitCode !== 0) {
      notes.push(
        tl('notes.vnc.clientUpFailed', {
          detail: (r.stderr || r.stdout || '').slice(0, 200),
        }),
      );
      rec.status = 'error';
      items[idx] = rec;
      saveClientProfiles(input.dataDir, items);
      return { ok: false, notes, profile: toPublic(rec) };
    }
    rec.pid = Number(r.stdout.trim().split('\n').pop()) || undefined;
    rec.localHttpPort = localHttp;
    rec.path = 'via_server';
    rec.status = 'up';
    rec.updatedAt = new Date().toISOString();
    items[idx] = rec;
    saveClientProfiles(input.dataDir, items);
    notes.push(
      tl('notes.vnc.clientViaServerUp', {
        name: rec.name,
        url: `http://127.0.0.1:${localHttp}/vnc.html?host=127.0.0.1&port=${localHttp}`,
      }),
    );
    return { ok: true, notes, profile: toPublic(rec) };
  }

  // direct — vncviewer
  const viewer =
    (await cmdExists(input.host, 'vncviewer')) ||
    (await cmdExists(input.host, 'xtigervncviewer'));
  if (!viewer) {
    notes.push(tl('notes.vnc.clientNeedViewer'));
    return { ok: false, notes, profile: toPublic(rec) };
  }
  const target = `${rec.host}::${rec.port}`;
  // TigerVNC often uses host:display or host::port
  const script = `nohup ${viewer} ${shellQuote(rec.host + '::' + rec.port)} >/tmp/ysk-vncviewer-${rec.id.slice(0, 8)}.log 2>&1 & echo $!`;
  const r = await input.host.runCommand(['bash', '-c', script], {
    timeoutMs: 15_000,
  });
  if (r.exitCode !== 0) {
    notes.push(
      tl('notes.vnc.clientUpFailed', {
        detail: (r.stderr || r.stdout || '').slice(0, 200),
      }),
    );
    rec.status = 'error';
    items[idx] = rec;
    saveClientProfiles(input.dataDir, items);
    return { ok: false, notes, profile: toPublic(rec) };
  }
  rec.pid = Number(r.stdout.trim().split('\n').pop()) || undefined;
  rec.path = 'direct';
  rec.status = 'up';
  rec.updatedAt = new Date().toISOString();
  items[idx] = rec;
  saveClientProfiles(input.dataDir, items);
  notes.push(tl('notes.vnc.clientDirectUp', { name: rec.name, target }));
  return { ok: true, notes, profile: toPublic(rec) };
}

async function cmdExists(host: HostExecutor, bin: string): Promise<string | null> {
  try {
    const r = await host.runCommand(
      ['bash', '-c', `command -v ${bin} 2>/dev/null || true`],
      { timeoutMs: 5_000 },
    );
    const line = r.stdout.trim().split('\n').find(Boolean);
    return line || null;
  } catch {
    if (existsSync(`/usr/bin/${bin}`)) return `/usr/bin/${bin}`;
    return null;
  }
}

export async function clientDown(input: {
  host: HostExecutor;
  dataDir: string;
  id: string;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
  profile?: VncClientProfile;
}> {
  const notes: string[] = [];
  const items = loadClientProfiles(input.dataDir);
  const idx = items.findIndex((x) => x.id === input.id);
  if (idx < 0) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.vnc.clientNotFound'), {
      httpStatus: 404,
    });
  }
  const rec = { ...items[idx] };
  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    notes.push(tl('notes.vnc.clientDownBlocked'));
    return {
      ok: false,
      notes,
      blocked: true,
      requiresExecute: !input.host.executeEnabled(),
      profile: toPublic(rec),
    };
  }
  if (rec.pid) {
    await input.host.runCommand(
      ['bash', '-c', `kill ${rec.pid} 2>/dev/null || true`],
      { timeoutMs: 5_000 },
    );
  }
  if (rec.localHttpPort) {
    await input.host.runCommand(
      [
        'bash',
        '-c',
        `pkill -f 'websockify.*${rec.localHttpPort}' 2>/dev/null || true`,
      ],
      { timeoutMs: 5_000 },
    );
  }
  rec.pid = undefined;
  rec.status = 'down';
  rec.updatedAt = new Date().toISOString();
  items[idx] = rec;
  saveClientProfiles(input.dataDir, items);
  notes.push(tl('notes.vnc.clientDown', { name: rec.name }));
  return { ok: true, notes, profile: toPublic(rec) };
}

export async function deleteClientProfile(input: {
  host: HostExecutor;
  dataDir: string;
  id: string;
}): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  // best-effort down
  try {
    await clientDown(input);
  } catch {
    /* ignore */
  }
  const items = loadClientProfiles(input.dataDir).filter((x) => x.id !== input.id);
  saveClientProfiles(input.dataDir, items);
  const conf = join(clientDir(input.dataDir), `${input.id}.json`);
  if (existsSync(conf)) {
    try {
      unlinkSync(conf);
    } catch {
      /* ignore */
    }
  }
  notes.push(tl('notes.vnc.clientDeleted'));
  return { ok: true, notes };
}

// silence unused import if tree-shaken weirdly
void novncPortForDisplay;
