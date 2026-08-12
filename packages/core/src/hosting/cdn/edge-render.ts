/**
 * CDN edge Nginx renderer (PR-C2).
 * Writes managed conf under dataDir; does not fan-out to remote edges (C3).
 * Honesty: written ≠ applied on edge nodes.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ErrorCodes,
  YskError,
  type ApplyStatus,
  type CdnNodeDto,
  type CdnSiteDto,  tl} from '@ysk-server/shared';
import type { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import { getCdnNode } from './nodes.js';
import { getCdnSite, patchCdnSiteStatus } from './sites.js';

export type CdnEdgeRenderResult = {
  ok: boolean;
  apply_status: ApplyStatus;
  siteId: string;
  confPath: string;
  managedNginxPath: string;
  contentHash: string;
  conf: string;
  originUpstream: string;
  notes: string[];
  written: string[];
  edge_status: Record<string, ApplyStatus>;
  blocked?: boolean;
  requiresExecute?: boolean;
};

function safeZoneId(siteId: string): string {
  return `ysk_cdn_${siteId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || 'site'}`;
}

function originHostPort(upstreamUrl: string): string {
  try {
    const u = new URL(upstreamUrl);
    const port =
      u.port ||
      (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '');
    return port ? `${u.hostname}:${port}` : u.hostname;
  } catch {
    return upstreamUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || '127.0.0.1:8080';
  }
}

function resolveOriginUpstream(
  site: CdnSiteDto,
  opts?: {
    projectOriginUrl?: string;
    /** When rendering for a non-shield edge, pull via shield */
    shieldUpstreamUrl?: string;
    isShieldEdge?: boolean;
  },
): { upstream: string; notes: string[] } {
  const notes: string[] = [];

  // Origin shield (PR-C7): non-shield edges use shield as upstream
  if (
    opts?.shieldUpstreamUrl &&
    !opts.isShieldEdge &&
    site.originShieldNodeId
  ) {
    notes.push(
      tl('notes.auto.t0707', { v0: (site.originShieldNodeId), v1: (opts.shieldUpstreamUrl) }),
    );
    return {
      upstream: opts.shieldUpstreamUrl.replace(/\/$/, ''),
      notes };
  }
  if (opts?.isShieldEdge && site.originShieldNodeId) {
    notes.push(tl('notes.auto.n0355'));
  }

  if (site.origin.kind === 'url') {
    return { upstream: site.origin.url!.replace(/\/$/, ''), notes };
  }
  if (opts?.projectOriginUrl) {
    notes.push(
      `origin project ${site.origin.projectId} → ${opts.projectOriginUrl}`,
    );
    return {
      upstream: opts.projectOriginUrl.replace(/\/$/, ''),
      notes };
  }
  const fallback = 'http://127.0.0.1:8080';
  notes.push(
    tl('notes.auto.t0708', { v0: (fallback) }),
  );
  return { upstream: fallback, notes };
}

export type CdnEdgeSslPaths = {
  /** Paths as seen on the edge (after distribute) */
  fullchain: string;
  privkey: string;
  /** ACME webroot for http-01 */
  acmeWebroot?: string;
  /** When true, HTTP only serves ACME + redirect (no full proxy on :80) */
  redirectHttp?: boolean;
};

/**
 * Pure renderer — no I/O.
 * PR-C6: optional TLS server block when sslPaths provided.
 */
export function renderCdnEdgeNginxConf(input: {
  site: CdnSiteDto;
  projectOriginUrl?: string;
  listenPort?: number;
  /** Edge-local cert paths (PR-C6) */
  sslPaths?: CdnEdgeSslPaths;
  /** Force HTTP-only ACME staging conf (before cert issued) */
  acmeOnly?: boolean;
  /** PR-C7 origin shield */
  shieldUpstreamUrl?: string;
  isShieldEdge?: boolean;
  /** Tag conf for which edge it was rendered (fan-out) */
  forEdgeNodeId?: string;
}): {
  conf: string;
  originUpstream: string;
  contentHash: string;
  notes: string[];
  sslEnabled: boolean;
} {
  const site = input.site;
  if (!site.domains.length) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0042'), { httpStatus: 400 });
  }
  const { upstream, notes } = resolveOriginUpstream(site, {
    projectOriginUrl: input.projectOriginUrl,
    shieldUpstreamUrl: input.shieldUpstreamUrl,
    isShieldEdge: input.isShieldEdge });
  const zone = safeZoneId(site.id);
  const cachePath = `/var/cache/ysk-cdn/${site.id}`;
  const serverNames = site.domains.join(' ');
  const listen = input.listenPort ?? 80;
  const maxAge = site.cache.maxAge || '10m';
  const zoneSize = site.cache.zoneSize || '10m';
  const cacheOn = site.cache.enabled !== false;
  const shortCache = site.mode === 'reverse_proxy' ? '30s' : maxAge;
  const upstreamPeer = originHostPort(upstream);
  const acmeRoot =
    input.sslPaths?.acmeWebroot ||
    `/var/www/ysk-cdn-acme/${site.id}`;
  const sslEnabled = Boolean(
    input.sslPaths?.fullchain &&
      input.sslPaths?.privkey &&
      !input.acmeOnly,
  );

  const bypass: string[] = ['$http_pragma'];
  if (site.cache.bypassCookies !== false) {
    bypass.push('$cookie_session', '$cookie_ysk_nocache');
  }
  if (site.cache.bypassAuth !== false) {
    bypass.push('$http_authorization');
  }
  const bypassExpr = bypass.join(' ');

  const sniBlock = site.origin.sni
    ? `    proxy_ssl_server_name on;\n    proxy_ssl_name ${site.origin.sni};\n`
    : '';

  const cacheBlock = cacheOn
    ? `    proxy_cache ${zone};
    proxy_cache_valid 200 301 302 ${shortCache};
    proxy_cache_valid 404 1m;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    proxy_cache_bypass ${bypassExpr};
    proxy_no_cache ${bypassExpr};
    add_header X-YSK-Cache $upstream_cache_status always;
    add_header X-YSK-CDN-Site ${site.id} always;
`
    : `    add_header X-YSK-Cache BYPASS always;
    add_header X-YSK-CDN-Site ${site.id} always;
`;

  const locationSlash = `  location / {
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
${sniBlock}    proxy_pass ${upstream};
${cacheBlock}  }
`;

  const staticLoc =
    cacheOn &&
    (site.mode === 'origin_pull' || site.mode === 'static_edge')
      ? `
  location ~* \\.(?:css|js|jpg|jpeg|gif|png|svg|webp|ico|woff2?)$ {
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
${sniBlock}    proxy_pass ${upstream};
    proxy_cache ${zone};
    proxy_cache_valid 200 1h;
    add_header X-YSK-Cache $upstream_cache_status always;
    expires 1h;
  }
`
      : '';

  const acmeLoc = `  location ^~ /.well-known/acme-challenge/ {
    default_type "text/plain";
    root ${acmeRoot};
  }

  location = /.ysk-cdn-health {
    access_log off;
    default_type text/plain;
    return 200 "ysk-cdn-ok\\n";
  }
`;

  let conf: string;

  if (input.acmeOnly || (site.ssl?.mode === 'le_http01' && !sslEnabled)) {
    conf = `# Managed by YSK CDN — site ${site.id} (ACME / HTTP)
# managedBy=cdn

proxy_cache_path ${cachePath} levels=1:2 keys_zone=${zone}:${zoneSize} max_size=1g inactive=60m use_temp_path=off;

upstream ysk_cdn_origin_${zone} {
  server ${upstreamPeer};
  keepalive 16;
}

server {
  listen ${listen};
  listen [::]:${listen};
  server_name ${serverNames};

${acmeLoc}
${locationSlash}${staticLoc}}
`;
    notes.push(tl('notes.auto.n0114'));
  } else if (sslEnabled && input.sslPaths) {
    const redir =
      input.sslPaths.redirectHttp !== false
        ? `  location / {
    return 301 https://$host$request_uri;
  }
`
        : locationSlash + staticLoc;

    conf = `# Managed by YSK CDN — site ${site.id} (TLS PR-C6)
# managedBy=cdn
# ssl fullchain=${input.sslPaths.fullchain}

proxy_cache_path ${cachePath} levels=1:2 keys_zone=${zone}:${zoneSize} max_size=1g inactive=60m use_temp_path=off;

upstream ysk_cdn_origin_${zone} {
  server ${upstreamPeer};
  keepalive 16;
}

server {
  listen 80;
  listen [::]:80;
  server_name ${serverNames};

${acmeLoc}
${redir}}

server {
  listen 443 ssl;
  listen [::]:443 ssl;
  http2 on;
  server_name ${serverNames};

  ssl_certificate ${input.sslPaths.fullchain};
  ssl_certificate_key ${input.sslPaths.privkey};
  ssl_session_timeout 1d;
  ssl_session_cache shared:ysk_cdn_ssl:10m;
  ssl_protocols TLSv1.2 TLSv1.3;

  location = /.ysk-cdn-health {
    access_log off;
    default_type text/plain;
    return 200 "ysk-cdn-ok\\n";
  }

${locationSlash}${staticLoc}}
`;
    notes.push(`TLS enabled cert=${input.sslPaths.fullchain}`);
  } else {
    conf = `# Managed by YSK CDN (PR-C2) — site ${site.id}
# managedBy=cdn — re-render from control plane; do not hand-edit
# NOTE: proxy_cache_path must live in http{} — if conf.d is server-only, move it to nginx.conf

proxy_cache_path ${cachePath} levels=1:2 keys_zone=${zone}:${zoneSize} max_size=1g inactive=60m use_temp_path=off;

upstream ysk_cdn_origin_${zone} {
  server ${upstreamPeer};
  keepalive 16;
}

server {
  listen ${listen};
  listen [::]:${listen};
  server_name ${serverNames};

  location = /.ysk-cdn-health {
    access_log off;
    default_type text/plain;
    return 200 "ysk-cdn-ok\\n";
  }

${locationSlash}${staticLoc}}
`;
  }

  const contentHash = createHash('sha256')
    .update(conf)
    .digest('hex')
    .slice(0, 16);
  const stamped = `# contentHash=${contentHash}\n${conf}`;

  notes.push(
    cacheOn
      ? `proxy_cache zone=${zone} maxAge≈${shortCache}`
      : 'cache disabled',
    `mode=${site.mode}`,
    `domains=${site.domains.join(',')}`,
    `origin=${upstream}`,
    sslEnabled ? 'ssl=on' : 'ssl=off',
  );
  if (input.forEdgeNodeId) {
    notes.push(`rendered for edge ${input.forEdgeNodeId.slice(0, 8)}`);
  }
  if (site.originShieldNodeId) {
    notes.push(
      input.isShieldEdge
        ? 'role=origin-shield'
        : `role=edge-via-shield(${site.originShieldNodeId.slice(0, 8)})`,
    );
  }

  return {
    conf: stamped,
    originUpstream: upstream,
    contentHash,
    notes,
    sslEnabled };
}

/**
 * Render + write managed conf for site (control plane).
 */
export async function applyCdnSiteEdgeRender(input: {
  db: JsonStore;
  dataDir: string;
  siteId: string;
  host?: HostExecutor;
  dryRun?: boolean;
  copyToNginxManaged?: boolean;
  projectOriginUrl?: string;
  /** Override SSL paths (edge-local) */
  sslPaths?: CdnEdgeSslPaths;
  acmeOnly?: boolean;
}): Promise<CdnEdgeRenderResult> {
  const site = getCdnSite(input.db, input.siteId);
  if (!site) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.cdn.siteNotFound'), {
      httpStatus: 404,
      details: { id: input.siteId } });
  }

  // SSL conf only when explicitly requested (PR-C6 distribute) or acmeOnly
  const rendered = renderCdnEdgeNginxConf({
    site,
    projectOriginUrl: input.projectOriginUrl,
    sslPaths: input.sslPaths,
    acmeOnly: input.acmeOnly });

  const notes = [...rendered.notes];
  const written: string[] = [];
  const edge_status: Record<string, ApplyStatus> = {};

  for (const eid of site.edgeNodeIds) {
    edge_status[eid] = 'planned';
    const node: CdnNodeDto | null = getCdnNode(input.db, eid);
    notes.push(
      node
        ? tl('notes.auto.t0709', { v0: (node.name), v1: (eid.slice(0, 8)) })
        : tl('notes.auto.t0710', { v0: (eid) }),
    );
  }

  if (input.dryRun) {
    notes.push(tl('notes.auto.n0276'));
    return {
      ok: true,
      apply_status: 'planned',
      siteId: site.id,
      confPath: '',
      managedNginxPath: '',
      contentHash: rendered.contentHash,
      conf: rendered.conf,
      originUpstream: rendered.originUpstream,
      notes,
      written: [],
      edge_status };
  }

  const siteDir = join(input.dataDir, 'cdn', 'sites', site.id);
  mkdirSync(siteDir, { recursive: true });
  const confPath = join(siteDir, 'edge.conf');
  writeFileSync(confPath, rendered.conf, 'utf8');
  written.push(confPath);

  const metaPath = join(siteDir, 'meta.json');
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        siteId: site.id,
        contentHash: rendered.contentHash,
        originUpstream: rendered.originUpstream,
        renderedAt: new Date().toISOString(),
        edgeNodeIds: site.edgeNodeIds },
      null,
      2,
    ),
    'utf8',
  );
  written.push(metaPath);

  let managedNginxPath = '';
  if (input.copyToNginxManaged !== false) {
    const nginxDir = join(input.dataDir, 'nginx', 'conf.d');
    mkdirSync(nginxDir, { recursive: true });
    managedNginxPath = join(
      nginxDir,
      `ysk-cdn-${site.id.slice(0, 8)}.conf`,
    );
    writeFileSync(managedNginxPath, rendered.conf, 'utf8');
    written.push(managedNginxPath);
    notes.push(tl('notes.auto.t0711', { v0: (managedNginxPath) }));
  }

  notes.push(tl('notes.auto.t0712', { v0: (confPath) }));
  notes.push(
    tl('notes.auto.n1228'),
  );

  if (
    input.host?.executeEnabled() &&
    input.host.pathExists('/usr/sbin/nginx')
  ) {
    const r = await input.host.runCommand(['nginx', '-t'], {
      timeoutMs: 10_000 });
    if (r.exitCode === 0) {
      notes.push(
        tl('notes.auto.n0996'),
      );
    } else {
      notes.push(
        tl('notes.auto.t0713', { v0: ((r.stderr || r.stdout).slice(0, 120)) }),
      );
    }
  }

  const updated = patchCdnSiteStatus(input.db, site.id, {
    apply_status: 'written',
    edge_status });

  return {
    ok: true,
    apply_status: updated.apply_status,
    siteId: site.id,
    confPath,
    managedNginxPath,
    contentHash: rendered.contentHash,
    conf: rendered.conf,
    originUpstream: rendered.originUpstream,
    notes,
    written,
    edge_status };
}

export function readCdnSiteRenderedConf(
  dataDir: string,
  siteId: string,
): { conf: string; meta?: Record<string, unknown> } | null {
  const confPath = join(dataDir, 'cdn', 'sites', siteId, 'edge.conf');
  if (!existsSync(confPath)) return null;
  const conf = readFileSync(confPath, 'utf8');
  const metaPath = join(dataDir, 'cdn', 'sites', siteId, 'meta.json');
  let meta: Record<string, unknown> | undefined;
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      meta = undefined;
    }
  }
  return { conf, meta };
}
