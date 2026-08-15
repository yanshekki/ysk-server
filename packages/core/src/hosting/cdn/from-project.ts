/**
 * One-click enable CDN from a project (PR-C7).
 * Creates site with origin=project, domains from project, all edge nodes by default.
 */

import {
  ErrorCodes,
  YskError,
  type CdnDnsStrategy,
  type CdnSiteDto,
  type ProjectDto,  tl} from 'ysk-server-shared';
import type { JsonStore } from '../../db/store.js';
import { listCdnNodes } from './nodes.js';
import { listCdnSites, upsertCdnSite } from './sites.js';

export type EnableCdnFromProjectInput = {
  db: JsonStore;
  project: ProjectDto;
  /** Override edge selection (default: all nodes with edge role) */
  edgeNodeIds?: string[];
  originShieldNodeId?: string;
  strategy?: CdnDnsStrategy;
  mode?: CdnSiteDto['mode'];
  /** geoMap optional */
  geoMap?: Record<string, string[]>;
  geoSubdomains?: boolean;
  name?: string;
  /** Extra domains beyond project.domain / aliases */
  extraDomains?: string[];
};

export type EnableCdnFromProjectResult = {
  ok: boolean;
  site: CdnSiteDto;
  created: boolean;
  notes: string[];
  projectOriginUrl: string;
};

/**
 * Build origin URL for a project (control-plane view).
 */
export function projectOriginUrl(project: ProjectDto): string {
  const port = project.port && project.port > 0 ? project.port : 8080;
  // Prefer loopback — origin usually on control/origin host
  return `http://127.0.0.1:${port}`;
}

export function isLoopbackOriginUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
  } catch {
    return /127\.0\.0\.1|localhost/.test(url);
  }
}

/** LAN/public origin for a remote edge. Empty if we cannot rewrite honestly. */
export function reachableOriginUrlForRemoteEdge(
  db: JsonStore,
  loopbackUrl: string,
  project?: { bindIp?: string; port?: number },
): string | undefined {
  let port = 8080;
  try {
    port = Number(new URL(loopbackUrl).port) || port;
  } catch {
    /* keep */
  }
  if (project?.port && project.port > 0) port = project.port;
  const bind = project?.bindIp?.trim();
  if (bind && bind !== '127.0.0.1' && bind !== '0.0.0.0' && bind !== '::') {
    return `http://${bind}:${port}`;
  }
  const nodes = listCdnNodes(db);
  const origin = nodes.find((n) => n.roles.includes('origin') && n.publicIpv4[0]);
  const ip =
    origin?.publicIpv4[0] ||
    nodes.find((n) => n.roles.includes('control') && n.publicIpv4[0])?.publicIpv4[0];
  if (ip && ip !== '127.0.0.1' && ip !== '::1') return `http://${ip}:${port}`;
  return undefined;
}

export function domainsFromProject(
  project: ProjectDto,
  extra?: string[],
): string[] {
  const list: string[] = [];
  if (project.domain?.trim()) list.push(project.domain.trim().toLowerCase());
  for (const a of project.domainAliases ?? []) {
    if (a?.trim()) list.push(a.trim().toLowerCase());
  }
  for (const e of extra ?? []) {
    if (e?.trim()) list.push(e.trim().toLowerCase());
  }
  return [...new Set(list)];
}

/**
 * Create or update CDN site bound to project.
 * Does not auto fan-out / DNS — returns site for operator to apply.
 */
export function enableCdnFromProject(
  input: EnableCdnFromProjectInput,
): EnableCdnFromProjectResult {
  const notes: string[] = [];
  const domains = domainsFromProject(input.project, input.extraDomains);
  if (!domains.length) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      tl('notes.auto.n0693'),
      { httpStatus: 400 },
    );
  }

  const edges =
    input.edgeNodeIds?.length
      ? input.edgeNodeIds
      : listCdnNodes(input.db)
          .filter((n) => n.roles.includes('edge'))
          .map((n) => n.id);

  if (!edges.length) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      tl('notes.auto.n1047'),
      { httpStatus: 400 },
    );
  }

  notes.push(tl('notes.auto.t0703', { v0: (edges.length) }));
  notes.push(`domains: ${domains.join(', ')}`);

  const originUrl = projectOriginUrl(input.project);
  notes.push(tl('notes.auto.t0704', { v0: (originUrl) }));
  const reachable = reachableOriginUrlForRemoteEdge(input.db, originUrl, {
    bindIp: input.project.bindIp,
    port: input.project.port,
  });
  const nodeById = new Map(listCdnNodes(input.db).map((n) => [n.id, n]));
  const hasRemoteEdge = edges.some((id) => {
    const n = nodeById.get(id);
    if (!n) return false;
    const ip = n.publicIpv4[0];
    if (ip && ip !== '127.0.0.1' && ip !== '::1') return true;
    return Boolean(n.baseUrl?.trim() || n.fleetAgentId?.trim() || n.sshHost?.trim());
  });
  if (reachable && reachable !== originUrl) {
    notes.push(tl('notes.cdn.originRemoteRewrite', { url: reachable }));
  } else if (hasRemoteEdge && isLoopbackOriginUrl(originUrl)) {
    notes.push(tl('notes.cdn.originRemoteUnknown'));
  }

  // Reuse existing site bound to same projectId if any
  const existing = listCdnSites(input.db).find(
    (s) =>
      s.origin.kind === 'project' &&
      s.origin.projectId === input.project.id,
  );

  const site = upsertCdnSite(input.db, {
    id: existing?.id,
    name:
      input.name?.trim() ||
      existing?.name ||
      `cdn-${input.project.name || input.project.id.slice(0, 8)}`,
    domains,
    mode: input.mode ?? existing?.mode ?? 'origin_pull',
    origin: {
      kind: 'project',
      projectId: input.project.id,
      url: originUrl,
      sni: domains[0],
    },
    edgeNodeIds: edges,
    originShieldNodeId: input.originShieldNodeId ?? existing?.originShieldNodeId,
    dns: {
      strategy: input.strategy ?? existing?.dns.strategy ?? 'multi_a',
      ttlHealthy: existing?.dns.ttlHealthy ?? 60,
      ttlUnhealthy: existing?.dns.ttlUnhealthy ?? 30,
      minHealthyEdges: existing?.dns.minHealthyEdges ?? 1,
      geoMap: input.geoMap ?? existing?.dns.geoMap,
      geoSubdomains: input.geoSubdomains ?? existing?.dns.geoSubdomains,
      zoneId: existing?.dns.zoneId,
    },
    cache: existing?.cache ?? {
      enabled: true,
      zoneSize: '10m',
      maxAge: '10m',
      bypassCookies: true,
      bypassAuth: true,
    },
    ssl: existing?.ssl ?? { mode: 'off' },
  });

  notes.push(
    existing
      ? tl('notes.auto.t0705', { v0: (site.id.slice(0, 8)) })
      : tl('notes.auto.t0706', { v0: (site.id.slice(0, 8)) }),
  );
  notes.push(
    tl('notes.auto.n0491'),
  );
  notes.push(
    tl('notes.auto.n1376'),
  );

  return {
    ok: true,
    site,
    created: !existing,
    notes,
    projectOriginUrl: originUrl,
  };
}
