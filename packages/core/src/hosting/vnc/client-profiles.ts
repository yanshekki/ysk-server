/**
 * Outbound VNC client profiles — both paths open in the browser via panel RFB proxy.
 * - user_reachable: public / user-side targets
 * - server_proxy: egress via control-plane network (LAN / server-reachable)
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
import { ErrorCodes, YskError, tl } from '@ysk/shared';
import type { VncClientProfile, VncConnectPath } from './types.js';
import { normalizeVncConnectPath } from './types.js';

export type VncClientRecord = {
  id: string;
  name: string;
  host: string;
  port: number;
  path: VncConnectPath;
  /** LAN / internal host for server_proxy TCP (optional). */
  connectHost?: string;
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
    const items = Array.isArray(raw.items) ? raw.items : [];
    return items.map((r) => ({
      ...r,
      path: normalizeVncConnectPath(r.path),
    }));
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
  const path = normalizeVncConnectPath(r.path);
  const connectHost = String(r.connectHost ?? '').trim();
  return {
    id: r.id,
    name: r.name,
    host: r.host,
    port: r.port,
    path,
    connectHost:
      path === 'server_proxy' && connectHost ? connectHost : null,
    status: r.status,
    autostart: r.autostart,
    createdAt: r.createdAt,
  };
}

export function listClientProfilesPublic(dataDir: string): VncClientProfile[] {
  return loadClientProfiles(dataDir).map(toPublic);
}

export function getClientProfileRecord(
  dataDir: string,
  id: string,
): VncClientRecord | null {
  return loadClientProfiles(dataDir).find((x) => x.id === id) ?? null;
}

export function createClientProfile(
  dataDir: string,
  input: {
    name: string;
    host: string;
    port: number;
    path?: VncConnectPath;
    /** server_proxy only: internal TCP host */
    connectHost?: string;
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
  const path = normalizeVncConnectPath(input.path ?? 'user_reachable');
  const connectHost = String(input.connectHost ?? '').trim();
  const items = loadClientProfiles(dataDir);
  const now = new Date().toISOString();
  const rec: VncClientRecord = {
    id: randomUUID(),
    name,
    host,
    port,
    path,
    connectHost:
      path === 'server_proxy' && connectHost ? connectHost : undefined,
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
    connectHost?: string | null;
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
  if (patch.path != null) rec.path = normalizeVncConnectPath(patch.path);
  if (patch.connectHost !== undefined) {
    const ch = String(patch.connectHost ?? '').trim();
    if (ch) rec.connectHost = ch;
    else delete rec.connectHost;
  }
  // user_reachable ignores internal override
  if (normalizeVncConnectPath(rec.path) !== 'server_proxy') {
    delete rec.connectHost;
  }
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
  const pathMode = normalizeVncConnectPath(input.path ?? rec.path);

  // Both paths use the in-browser VNC client (panel RFB proxy). Persist path intent only.
  rec.path = pathMode;
  rec.status = 'up';
  rec.updatedAt = new Date().toISOString();
  // Stop any legacy websockify/vncviewer leftover from older builds
  if (
    (rec.pid || rec.localHttpPort) &&
    input.host.executeEnabled() &&
    input.host.isRoot()
  ) {
    try {
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
    } catch {
      /* */
    }
  }
  rec.pid = undefined;
  items[idx] = rec;
  saveClientProfiles(input.dataDir, items);
  notes.push(
    pathMode === 'server_proxy'
      ? tl('notes.vnc.clientPathServerProxy', {
          name: rec.name,
          target: `${rec.host}:${rec.port}`,
        })
      : tl('notes.vnc.clientPathUserReachable', {
          name: rec.name,
          target: `${rec.host}:${rec.port}`,
        }),
  );
  notes.push(tl('notes.vnc.clientOpenInBrowserHint'));
  return { ok: true, notes, profile: toPublic(rec) };
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
