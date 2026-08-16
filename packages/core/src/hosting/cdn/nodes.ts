/**
 * CDN node registry (PR-C1): CRUD + health probe + drain.
 * Does not configure nginx or DNS yet (C2+).
 */

import { randomUUID } from 'node:crypto';
import {
  ErrorCodes,
  YskError,
  type CdnNodeDto,
  type CdnNodeRole,
  type CdnNodeStatus,  tl} from 'ysk-server-shared';
import type { JsonStore } from '../../db/store.js';
import { probeTcp } from '../../email/live-checks.js';
import { assertSafeOutboundUrl } from '../../net/ssrf.js';
import { classifyHttpProbeFailure } from './http-probe-error.js';

const KEY = 'cdn_nodes';
const MAX = 50;

const ROLES: CdnNodeRole[] = ['control', 'origin', 'edge', 'dns'];

export type UpsertCdnNodeInput = {
  id?: string;
  name: string;
  baseUrl?: string;
  fleetAgentId?: string;
  sshIdentityId?: string;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  remoteNginxConfDir?: string;
  roles?: CdnNodeRole[] | string[];
  region?: string;
  publicIpv4?: string[];
  publicIpv6?: string[];
  healthUrl?: string;
  weight?: number;
  status?: CdnNodeStatus;
};

function isLoopbackHostName(h: string): boolean {
  const x = h.toLowerCase();
  return x === '127.0.0.1' || x === 'localhost' || x === '::1' || x === '0.0.0.0';
}

/** True when this node is the control-plane host, not a remote edge. */
export function isLocalCdnEdge(node: CdnNodeDto): boolean {
  const ip = node.publicIpv4[0];
  if (ip && !isLoopbackHostName(ip)) return false;
  const base = node.baseUrl?.trim();
  if (base) {
    try {
      const host = new URL(base).hostname;
      if (host && !isLoopbackHostName(host)) return false;
    } catch {
      /* ignore */
    }
  }
  if (node.fleetAgentId?.trim()) return false;
  const ssh = node.sshHost?.trim();
  if (ssh && !isLoopbackHostName(ssh)) return false;
  return true;
}

/** SSH fan-out only when the operator set identity / host / non-default user. */
export function resolveCdnSshTarget(node: CdnNodeDto): {
  host: string;
  port: number;
  username: string;
} | null {
  const username = node.sshUsername?.trim() || '';
  const explicitIdentity = Boolean(node.sshIdentityId?.trim());
  const explicitUser = Boolean(username) && username !== 'root';
  const panelTransport = Boolean(node.baseUrl?.trim() || node.fleetAgentId?.trim());
  const onlinePanel = panelTransport && node.status === 'online';
  // Online panel / fleet edges use inbound apply — leftover root@sshHost must not win.
  if (onlinePanel && !explicitIdentity) return null;
  if (node.fleetAgentId?.trim() && !explicitIdentity && !explicitUser) return null;
  const host =
    node.sshHost?.trim() ||
    node.publicIpv4[0] ||
    (node.baseUrl
      ? (() => {
          try {
            return new URL(node.baseUrl).hostname;
          } catch {
            return '';
          }
        })()
      : '');
  if (!host) return null;
  if (
    !explicitIdentity &&
    !explicitUser &&
    !panelTransport &&
    !node.publicIpv4[0] &&
    !node.sshHost?.trim()
  ) {
    return null;
  }
  return {
    host,
    port: node.sshPort && node.sshPort > 0 ? node.sshPort : 22,
    username: username || 'root',
  };
}

function assertName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 80) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1304'), {
      httpStatus: 400,
      details: { name } });
  }
  return n;
}

function normalizeRoles(raw?: string[] | CdnNodeRole[]): CdnNodeRole[] {
  const list = (raw ?? ['edge'])
    .map((r) => String(r).toLowerCase().trim())
    .filter(Boolean) as CdnNodeRole[];
  const uniq = [...new Set(list.filter((r) => ROLES.includes(r)))];
  if (!uniq.length) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1343'), {
      httpStatus: 400 });
  }
  return uniq;
}

function normalizeIps(list: string[] | undefined, family: 4 | 6): string[] {
  if (!list?.length) return [];
  const out: string[] = [];
  for (const raw of list) {
    const ip = String(raw).trim();
    if (!ip) continue;
    if (family === 4) {
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0751', { v0: (ip) }), {
          httpStatus: 400 });
      }
    } else if (!ip.includes(':')) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0752', { v0: (ip) }), {
        httpStatus: 400 });
    }
    if (!out.includes(ip)) out.push(ip);
  }
  return out.slice(0, 16);
}

function normalizeHealthUrl(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  // CDN fleet may use private health endpoints; still block IMDS/loopback
  const u = assertSafeOutboundUrl(raw.trim(), { field: 'healthUrl', policy: 'metadata' });
  return u.toString().slice(0, 500);
}

function loadAll(db: JsonStore): CdnNodeDto[] {
  try {
    return JSON.parse(db.snapshot.settings?.[KEY] ?? '[]') as CdnNodeDto[];
  } catch {
    return [];
  }
}

function saveAll(db: JsonStore, nodes: CdnNodeDto[]): void {
  db.snapshot.settings[KEY] = JSON.stringify(nodes.slice(0, MAX));
  db.persist();
}

export function listCdnNodes(db: JsonStore): CdnNodeDto[] {
  return loadAll(db);
}

export function getCdnNode(db: JsonStore, id: string): CdnNodeDto | null {
  return loadAll(db).find((n) => n.id === id) ?? null;
}

export function upsertCdnNode(db: JsonStore, input: UpsertCdnNodeInput): CdnNodeDto {
  const all = loadAll(db);
  const id = input.id?.trim() || randomUUID();
  const prev = all.find((n) => n.id === id);
  if (!prev && all.length >= MAX) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0753', { v0: (MAX) }), {
      httpStatus: 400 });
  }

  const name = assertName(input.name);
  const roles = normalizeRoles(input.roles ?? prev?.roles);
  const publicIpv4 = normalizeIps(
    input.publicIpv4 ?? prev?.publicIpv4,
    4,
  );
  const publicIpv6 = normalizeIps(
    input.publicIpv6 ?? prev?.publicIpv6,
    6,
  );
  const weight =
    typeof input.weight === 'number' && Number.isFinite(input.weight)
      ? Math.max(0, Math.min(1000, Math.round(input.weight)))
      : (prev?.weight ?? 100);

  let status: CdnNodeStatus =
    input.status ?? prev?.status ?? 'unknown';
  if (!['online', 'offline', 'draining', 'unknown'].includes(status)) {
    status = 'unknown';
  }

  const sshPortRaw = input.sshPort ?? prev?.sshPort;
  const sshPort =
    typeof sshPortRaw === 'number' && sshPortRaw > 0 && sshPortRaw <= 65535
      ? Math.round(sshPortRaw)
      : undefined;

  const baseUrlRaw = input.baseUrl?.trim() || prev?.baseUrl;
  if (baseUrlRaw) {
    assertSafeOutboundUrl(baseUrlRaw, { field: 'baseUrl', policy: 'metadata' });
  }

  const row: CdnNodeDto = {
    id,
    name,
    baseUrl: baseUrlRaw,
    fleetAgentId: input.fleetAgentId?.trim() || prev?.fleetAgentId,
    sshIdentityId: input.sshIdentityId?.trim() || prev?.sshIdentityId,
    sshHost: (input.sshHost ?? prev?.sshHost)?.trim() || undefined,
    sshPort,
    sshUsername:
      (input.sshUsername ?? prev?.sshUsername)?.trim() || undefined,
    remoteNginxConfDir:
      (input.remoteNginxConfDir ?? prev?.remoteNginxConfDir)?.trim() ||
      undefined,
    roles,
    region: (input.region ?? prev?.region ?? 'default').trim() || 'default',
    publicIpv4,
    publicIpv6,
    healthUrl: normalizeHealthUrl(input.healthUrl ?? prev?.healthUrl),
    weight,
    status,
    lastHeartbeatAt: prev?.lastHeartbeatAt,
    lastHealth: prev?.lastHealth };

  // Need at least one reachability handle: IP, health, baseUrl, SSH host, or fleet session
  if (
    !row.publicIpv4.length &&
    !row.publicIpv6.length &&
    !row.healthUrl &&
    !row.baseUrl &&
    !row.sshHost &&
    !row.fleetAgentId
  ) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      tl('notes.auto.n1426'),
      { httpStatus: 400 },
    );
  }

  const next = [row, ...all.filter((n) => n.id !== id)];
  saveAll(db, next);
  return row;
}

export function deleteCdnNode(db: JsonStore, id: string): boolean {
  const all = loadAll(db);
  const next = all.filter((n) => n.id !== id);
  if (next.length === all.length) return false;
  saveAll(db, next);
  return true;
}

/**
 * Mark node draining (stop receiving new CDN DNS traffic later).
 * Probe still runs; status stays draining until undrain.
 */
export function setCdnNodeDrain(
  db: JsonStore,
  id: string,
  draining: boolean,
): CdnNodeDto {
  const node = getCdnNode(db, id);
  if (!node) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.n0044'), {
      httpStatus: 404,
      details: { id } });
  }
  if (draining) {
    return upsertCdnNode(db, { ...node, status: 'draining' });
  }
  // undrain → unknown until next probe
  return upsertCdnNode(db, {
    ...node,
    status: node.lastHealth?.ok ? 'online' : 'unknown' });
}

export type CdnNodeProbeResult = {
  ok: boolean;
  node: CdnNodeDto;
  notes: string[];
  method: 'http' | 'tcp' | 'none';
  latencyMs?: number;
};

/**
 * Probe one node. Honest: no healthUrl and no IP → ok=false unknown.
 * Draining nodes keep status=draining even if health ok.
 */
export async function probeCdnNode(
  db: JsonStore,
  id: string,
): Promise<CdnNodeProbeResult> {
  const node = getCdnNode(db, id);
  if (!node) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.n0044'), {
      httpStatus: 404,
      details: { id } });
  }

  const notes: string[] = [];
  const t0 = Date.now();
  let ok = false;
  let method: CdnNodeProbeResult['method'] = 'none';

  const healthTarget =
    node.healthUrl ||
    (node.baseUrl
      ? node.baseUrl.replace(/\/$/, '') + '/.ysk-cdn-health'
      : undefined);

  if (healthTarget) {
    method = 'http';
    try {
      // Re-check at probe time (stored URL may predate SSRF gate)
      assertSafeOutboundUrl(healthTarget, { field: 'healthUrl', policy: 'metadata' });
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8_000);
      const res = await fetch(healthTarget, {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
        headers: { 'User-Agent': 'ysk-cdn-probe/1' } });
      clearTimeout(timer);
      // 2xx–3xx and even 404 on custom path still proves host reachable
      ok = res.status > 0 && res.status < 500;
      notes.push(
        ok
          ? `HTTP ${res.status} ${healthTarget}`
          : tl('notes.auto.t0754', { v0: (res.status), v1: (healthTarget) }),
      );
      if (!node.healthUrl && node.baseUrl) {
        notes.push(
          tl('notes.auto.n0539'),
        );
      }
    } catch (e) {
      ok = false;
      const cls = classifyHttpProbeFailure(e);
      notes.push(tl(`notes.cdn.probe.${cls.code}`, { detail: cls.detail, ms: Date.now() - t0 }));
    }
  } else if (node.publicIpv4[0]) {
    method = 'tcp';
    const ip = node.publicIpv4[0];
    // Prefer 443 then 80
    const p443 = await probeTcp(ip, 443, 4_000);
    if (p443) {
      ok = true;
      notes.push(`TCP ${ip}:443 open`);
    } else {
      const p80 = await probeTcp(ip, 80, 4_000);
      ok = p80;
      notes.push(
        p80 ? `TCP ${ip}:80 open` : tl('notes.auto.t0756', { v0: (ip) }),
      );
    }
  } else {
    notes.push(tl('notes.auto.n1094'));
  }

  const latencyMs = Date.now() - t0;
  const at = new Date().toISOString();
  const wasDraining = node.status === 'draining';
  let status: CdnNodeStatus = wasDraining
    ? 'draining'
    : ok
      ? 'online'
      : 'offline';

  if (wasDraining) {
    notes.push(tl('notes.auto.n1305'));
  }

  const updated: CdnNodeDto = {
    ...node,
    status,
    lastHeartbeatAt: at,
    lastHealth: { ok, latencyMs, at } };

  const all = loadAll(db).map((n) => (n.id === id ? updated : n));
  saveAll(db, all);

  return { ok, node: updated, notes, method, latencyMs };
}

export async function probeAllCdnNodes(db: JsonStore): Promise<{
  ok: boolean;
  notes: string[];
  items: CdnNodeProbeResult[];
}> {
  const nodes = loadAll(db);
  if (!nodes.length) {
    return { ok: true, notes: [tl('notes.auto.n0711')], items: [] };
  }
  const items: CdnNodeProbeResult[] = [];
  for (const n of nodes) {
    items.push(await probeCdnNode(db, n.id));
  }
  const healthy = items.filter((i) => i.ok).length;
  const ok = healthy === items.length;
  return {
    ok,
    notes: [
      tl('notes.auto.t0757', { v0: (healthy), v1: (items.length) }),
      ...items.map(
        (i) =>
          `${i.node.name}: ${i.ok ? 'ok' : 'fail'} (${i.method}${i.latencyMs != null ? ` ${i.latencyMs}ms` : ''})`,
      ),
    ],
    items };
}
