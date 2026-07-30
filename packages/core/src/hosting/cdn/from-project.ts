/**
 * One-click enable CDN from a project (PR-C7).
 * Creates site with origin=project, domains from project, all edge nodes by default.
 */

import {
  ErrorCodes,
  YskError,
  type CdnDnsStrategy,
  type CdnSiteDto,
  type ProjectDto,  tl} from '@ysk/shared';
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
