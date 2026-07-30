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
  type CdnSiteMode,
} from '@ysk/shared';
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
    throw new YskError(ErrorCodes.VALIDATION, '站點名稱無效', {
      httpStatus: 400,
    });
  }
  return n;
}

function normalizeDomains(raw?: string[]): string[] {
  const list = (raw ?? [])
    .map((d) => String(d).trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
  const uniq = [...new Set(list)];
  if (!uniq.length) {
    throw new YskError(ErrorCodes.VALIDATION, '至少需要一個域名', {
      httpStatus: 400,
    });
  }
  for (const d of uniq) {
    if (d.length > 253 || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(d)) {
      throw new YskError(ErrorCodes.VALIDATION, `域名無效：${d}`, {
        httpStatus: 400,
      });
    }
  }
  return uniq.slice(0, 20);
}

function normalizeMode(raw?: string): CdnSiteMode {
  const m = (raw ?? 'origin_pull').toLowerCase() as CdnSiteMode;
  if (!MODES.includes(m)) {
    throw new YskError(ErrorCodes.VALIDATION, `不支援的 mode：${raw}`, {
      httpStatus: 400,
    });
  }
  return m;
}

function normalizeOrigin(
  raw?: CdnSiteDto['origin'],
  prev?: CdnSiteDto['origin'],
): CdnSiteDto['origin'] {
  const kind = raw?.kind ?? prev?.kind ?? 'url';
  if (kind !== 'project' && kind !== 'url') {
    throw new YskError(ErrorCodes.VALIDATION, 'origin.kind 必須是 project 或 url', {
      httpStatus: 400,
    });
  }
  if (kind === 'project') {
    const projectId = (raw?.projectId ?? prev?.projectId ?? '').trim();
    if (!projectId) {
      throw new YskError(ErrorCodes.VALIDATION, 'origin.project 需要 projectId', {
        httpStatus: 400,
      });
    }
    return {
      kind: 'project',
      projectId,
      url: raw?.url ?? prev?.url,
      sni: raw?.sni ?? prev?.sni,
    };
  }
  const url = (raw?.url ?? prev?.url ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new YskError(ErrorCodes.VALIDATION, 'origin.url 必須是 http(s) URL', {
      httpStatus: 400,
    });
  }
  return {
    kind: 'url',
    url,
    sni: raw?.sni ?? prev?.sni,
  };
}

function normalizeEdges(
  db: JsonStore,
  ids: string[] | undefined,
  prev?: string[],
): string[] {
  const list = [...new Set((ids ?? prev ?? []).map((x) => String(x).trim()).filter(Boolean))];
  if (!list.length) {
    throw new YskError(ErrorCodes.VALIDATION, '至少選擇一個 edge 節點', {
      httpStatus: 400,
    });
  }
  for (const id of list) {
    const n = getCdnNode(db, id);
    if (!n) {
      throw new YskError(ErrorCodes.VALIDATION, `找不到 edge 節點：${id}`, {
        httpStatus: 400,
      });
    }
    if (!n.roles.includes('edge') && !n.roles.includes('origin')) {
      // allow origin-only as temporary single-node; warn via roles still ok if has any role
      // Strict: prefer edge role
      if (!n.roles.includes('control')) {
        throw new YskError(
          ErrorCodes.VALIDATION,
          `節點 ${n.name} 需有 edge（或 origin）角色`,
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
    throw new YskError(ErrorCodes.VALIDATION, `不支援的 DNS 策略：${strategy}`, {
      httpStatus: 400,
    });
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
  };
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
    bypassAuth: partial?.bypassAuth ?? prev?.bypassAuth ?? true,
  };
}

function defaultSsl(
  partial?: Partial<CdnSiteDto['ssl']>,
  prev?: CdnSiteDto['ssl'],
): CdnSiteDto['ssl'] {
  const mode = partial?.mode ?? prev?.mode ?? 'off';
  if (!['off', 'le_http01', 'le_dns01', 'upload'].includes(mode)) {
    throw new YskError(ErrorCodes.VALIDATION, `不支援的 SSL mode：${mode}`, {
      httpStatus: 400,
    });
  }
  return {
    mode,
    certId: partial?.certId ?? prev?.certId,
  };
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
    throw new YskError(ErrorCodes.VALIDATION, `CDN 站點上限 ${MAX}`, {
      httpStatus: 400,
    });
  }

  // Ensure at least one node exists for edge binding
  if (!listCdnNodes(db).length) {
    throw new YskError(ErrorCodes.VALIDATION, '請先登記至少一個 CDN 節點（PR-C1）', {
      httpStatus: 400,
    });
  }

  const row: CdnSiteDto = {
    id,
    name: assertName(input.name),
    domains: normalizeDomains(input.domains ?? prev?.domains),
    mode: normalizeMode(input.mode ?? prev?.mode),
    origin: normalizeOrigin(input.origin, prev?.origin),
    edgeNodeIds: normalizeEdges(db, input.edgeNodeIds, prev?.edgeNodeIds),
    dns: defaultDns(input.dns, prev?.dns),
    cache: defaultCache(input.cache, prev?.cache),
    ssl: defaultSsl(input.ssl, prev?.ssl),
    apply_status: prev?.apply_status ?? 'draft',
    edge_status: prev?.edge_status ?? {},
  };

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
  },
): CdnSiteDto {
  const site = getCdnSite(db, id);
  if (!site) {
    throw new YskError(ErrorCodes.NOT_FOUND, '找不到 CDN 站點', {
      httpStatus: 404,
      details: { id },
    });
  }
  const updated: CdnSiteDto = {
    ...site,
    apply_status: patch.apply_status ?? site.apply_status,
    edge_status: patch.edge_status ?? site.edge_status,
  };
  const all = loadAll(db).map((s) => (s.id === id ? updated : s));
  saveAll(db, all);
  return updated;
}
