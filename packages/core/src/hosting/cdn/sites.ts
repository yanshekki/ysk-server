/**
 * CDN site policy store (PR-C2).
 * Sites describe domains/origin/edges/cache; apply is separate (render/fan-out).
 */

import { randomUUID } from 'node:crypto';
import {
  ErrorCodes,
  YskError,
  type ApplyStatus,
  type CdnDnsStrategy,
  type CdnSiteDto,
  type CdnSiteMode,  tl} from 'ysk-server-shared';
import type { JsonStore } from '../../db/store.js';
import { getCdnNode, listCdnNodes } from './nodes.js';

const KEY = 'cdn_sites';
const MAX = 50;

const MODES: CdnSiteMode[] = ['origin_pull', 'reverse_proxy', 'static_edge'];
const STRATEGIES: CdnDnsStrategy[] = [
  'single',
  'multi_a',
  'failover',
  'weighted',
  'geo',
];

export type UpsertCdnSiteInput = {
  id?: string;
  name: string;
  domains?: string[];
  mode?: CdnSiteMode | string;
  origin?: CdnSiteDto['origin'];
  edgeNodeIds?: string[];
  originShieldNodeId?: string | null;
  dns?: Partial<CdnSiteDto['dns']>;
  cache?: Partial<CdnSiteDto['cache']>;
  ssl?: Partial<CdnSiteDto['ssl']>;
};

function loadAll(db: JsonStore): CdnSiteDto[] {
  try {
    return JSON.parse(db.snapshot.settings?.[KEY] ?? '[]') as CdnSiteDto[];
  } catch {
    return [];
  }
}

function saveAll(db: JsonStore, sites: CdnSiteDto[]): void {
  db.snapshot.settings[KEY] = JSON.stringify(sites.slice(0, MAX));
  db.persist();
}

function assertName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 80) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1300'), {
      httpStatus: 400 });
  }
  return n;
}

function normalizeDomains(raw?: string[]): string[] {
  const list = (raw ?? [])
    .map((d) => String(d).trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
  const uniq = [...new Set(list)];
  if (!uniq.length) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1341'), {
      httpStatus: 400 });
  }
  for (const d of uniq) {
    if (d.length > 253 || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(d)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.tpl.domainInvalid', { domain: d }), {
        httpStatus: 400 });
    }
  }
  return uniq.slice(0, 20);
}

function normalizeMode(raw?: string): CdnSiteMode {
  const m = (raw ?? 'origin_pull').toLowerCase() as CdnSiteMode;
  if (!MODES.includes(m)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0696', { v0: (raw) }), {
      httpStatus: 400 });
  }
  return m;
}

function normalizeOrigin(
  raw?: CdnSiteDto['origin'],
  prev?: CdnSiteDto['origin'],
): CdnSiteDto['origin'] {
  const kind = raw?.kind ?? prev?.kind ?? 'url';
  if (kind !== 'project' && kind !== 'url') {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0356'), {
      httpStatus: 400 });
  }
  if (kind === 'project') {
    const projectId = (raw?.projectId ?? prev?.projectId ?? '').trim();
    if (!projectId) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0357'), {
        httpStatus: 400 });
    }
    return {
      kind: 'project',
      projectId,
      url: raw?.url ?? prev?.url,
      sni: raw?.sni ?? prev?.sni };
  }
  const url = (raw?.url ?? prev?.url ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0358'), {
      httpStatus: 400 });
  }
  return {
    kind: 'url',
    url,
    sni: raw?.sni ?? prev?.sni };
}

function normalizeEdges(
  db: JsonStore,
  ids: string[] | undefined,
  prev?: string[],
): string[] {
  const list = [...new Set((ids ?? prev ?? []).map((x) => String(x).trim()).filter(Boolean))];
  if (!list.length) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1340'), {
      httpStatus: 400 });
  }
  for (const id of list) {
    const n = getCdnNode(db, id);
    if (!n) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0697', { v0: (id) }), {
        httpStatus: 400 });
    }
    if (!n.roles.includes('edge') && !n.roles.includes('origin')) {
      // allow origin-only as temporary single-node; warn via roles still ok if has any role
      // Strict: prefer edge role
      if (!n.roles.includes('control')) {
        throw new YskError(
          ErrorCodes.VALIDATION,
          tl('notes.auto.t0698', { v0: (n.name) }),
          { httpStatus: 400 },
        );
      }
    }
  }
  return list.slice(0, 32);
}

function defaultDns(
  partial?: Partial<CdnSiteDto['dns']>,
  prev?: CdnSiteDto['dns'],
): CdnSiteDto['dns'] {
  const strategy = (partial?.strategy ??
    prev?.strategy ??
    'multi_a') as CdnDnsStrategy;
  if (!STRATEGIES.includes(strategy)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0699', { v0: (strategy) }), {
      httpStatus: 400 });
  }
  return {
    zoneId: partial?.zoneId ?? prev?.zoneId,
    strategy,
    ttlHealthy: Math.max(
      30,
      Math.min(3600, partial?.ttlHealthy ?? prev?.ttlHealthy ?? 60),
    ),
    ttlUnhealthy: Math.max(
      10,
      Math.min(600, partial?.ttlUnhealthy ?? prev?.ttlUnhealthy ?? 30),
    ),
    minHealthyEdges: Math.max(
      1,
      Math.min(16, partial?.minHealthyEdges ?? prev?.minHealthyEdges ?? 1),
    ),
    geoMap: partial?.geoMap ?? prev?.geoMap,
    geoSubdomains:
      partial?.geoSubdomains ?? prev?.geoSubdomains ?? false,
    geoDefaultRegion:
      (partial?.geoDefaultRegion ?? prev?.geoDefaultRegion)?.trim() ||
      undefined };
}

function defaultCache(
  partial?: Partial<CdnSiteDto['cache']>,
  prev?: CdnSiteDto['cache'],
): CdnSiteDto['cache'] {
  return {
    enabled: partial?.enabled ?? prev?.enabled ?? true,
    zoneSize: (partial?.zoneSize ?? prev?.zoneSize ?? '10m').trim() || '10m',
    maxAge: (partial?.maxAge ?? prev?.maxAge ?? '10m').trim() || '10m',
    bypassCookies: partial?.bypassCookies ?? prev?.bypassCookies ?? true,
    bypassAuth: partial?.bypassAuth ?? prev?.bypassAuth ?? true };
}

function defaultSsl(
  partial?: Partial<CdnSiteDto['ssl']>,
  prev?: CdnSiteDto['ssl'],
): CdnSiteDto['ssl'] {
  const mode = partial?.mode ?? prev?.mode ?? 'off';
  if (!['off', 'le_http01', 'le_dns01', 'upload'].includes(mode)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0700', { v0: (mode) }), {
      httpStatus: 400 });
  }
  return {
    mode,
    certId: partial?.certId ?? prev?.certId };
}

export function listCdnSites(db: JsonStore): CdnSiteDto[] {
  return loadAll(db);
}

export function getCdnSite(db: JsonStore, id: string): CdnSiteDto | null {
  return loadAll(db).find((s) => s.id === id) ?? null;
}

export function upsertCdnSite(
  db: JsonStore,
  input: UpsertCdnSiteInput,
): CdnSiteDto {
  const all = loadAll(db);
  const id = input.id?.trim() || randomUUID();
  const prev = all.find((s) => s.id === id);
  if (!prev && all.length >= MAX) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0701', { v0: (MAX) }), {
      httpStatus: 400 });
  }

  // Ensure at least one node exists for edge binding
  if (!listCdnNodes(db).length) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1380'), {
      httpStatus: 400 });
  }

  let originShieldNodeId: string | undefined;
  if (input.originShieldNodeId === null) {
    originShieldNodeId = undefined;
  } else if (input.originShieldNodeId?.trim()) {
    const sid = input.originShieldNodeId.trim();
    const n = getCdnNode(db, sid);
    if (!n) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0702', { v0: (sid) }), {
        httpStatus: 400 });
    }
    originShieldNodeId = sid;
  } else {
    originShieldNodeId = prev?.originShieldNodeId;
  }

  const row: CdnSiteDto = {
    id,
    name: assertName(input.name),
    domains: normalizeDomains(input.domains ?? prev?.domains),
    mode: normalizeMode(input.mode ?? prev?.mode),
    origin: normalizeOrigin(input.origin, prev?.origin),
    edgeNodeIds: normalizeEdges(db, input.edgeNodeIds, prev?.edgeNodeIds),
    originShieldNodeId,
    dns: defaultDns(input.dns, prev?.dns),
    cache: defaultCache(input.cache, prev?.cache),
    ssl: defaultSsl(input.ssl, prev?.ssl),
    apply_status: prev?.apply_status ?? 'draft',
    edge_status: prev?.edge_status ?? {} };

  // Shield must be one of the site edges
  if (
    row.originShieldNodeId &&
    !row.edgeNodeIds.includes(row.originShieldNodeId)
  ) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      tl('notes.auto.n0359'),
      { httpStatus: 400 },
    );
  }

  // New domains/origin/edges reset overall status to draft if content-ish change
  if (prev) {
    const changed =
      prev.domains.join() !== row.domains.join() ||
      prev.origin.url !== row.origin.url ||
      prev.origin.projectId !== row.origin.projectId ||
      prev.edgeNodeIds.join() !== row.edgeNodeIds.join() ||
      prev.mode !== row.mode ||
      JSON.stringify(prev.cache) !== JSON.stringify(row.cache);
    if (changed && prev.apply_status === 'applied') {
      row.apply_status = 'draft';
      row.edge_status = {};
    }
  }

  const next = [row, ...all.filter((s) => s.id !== id)];
  saveAll(db, next);
  return row;
}

export function deleteCdnSite(db: JsonStore, id: string): boolean {
  const all = loadAll(db);
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  saveAll(db, next);
  return true;
}

export function patchCdnSiteStatus(
  db: JsonStore,
  id: string,
  patch: {
    apply_status?: ApplyStatus;
    edge_status?: Record<string, ApplyStatus>;
    lastApplyAt?: string;
    lastApplyError?: string | null;
  },
): CdnSiteDto {
  const site = getCdnSite(db, id);
  if (!site) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.cdn.siteNotFound'), {
      httpStatus: 404,
      details: { id } });
  }
  const updated: CdnSiteDto = {
    ...site,
    apply_status: patch.apply_status ?? site.apply_status,
    edge_status: patch.edge_status ?? site.edge_status,
    lastApplyAt: patch.lastApplyAt ?? site.lastApplyAt,
    lastApplyError:
      patch.lastApplyError === null
        ? undefined
        : patch.lastApplyError ?? site.lastApplyError,
  };
  const all = loadAll(db).map((s) => (s.id === id ? updated : s));
  saveAll(db, all);
  return updated;
}
