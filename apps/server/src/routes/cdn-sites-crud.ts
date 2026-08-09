/**
 * CDN sites CRUD, from-project, health-loop, dashboard.
 * Extracted from cdn-sites.ts (Wave O3). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import { listWithQuery } from '../http/list-response.js';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleCdnSitesCrudRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      // —— CDN sites (PR-C2): policy + edge nginx render (written, not fan-out) ——
      if (method === 'GET' && url.pathname === '/api/v1/cdn/sites') {
        ctx.auth.authenticate(getBearer(req));
        const { listCdnSites } = await import('@ysk/core');
        type Site = {
          id?: string;
          name?: string;
          domains?: string[];
          domain?: string;
        };
        const all = listCdnSites(ctx.db) as unknown as Site[];
        const { items, meta } = listWithQuery(url, all, {
          text: (s: Site) => [
            String(s.id ?? ''),
            String(s.name ?? ''),
            ...(Array.isArray(s.domains) ? s.domains : [String(s.domain ?? '')]),
          ],
        });
        sendJson(res, 200, { items, meta });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/cdn/sites') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as Record<string, unknown>;
        const { upsertCdnSite } = await import('@ysk/core');
        const domainsRaw = data.domains;
        const domains = Array.isArray(domainsRaw)
          ? (domainsRaw as string[])
          : typeof domainsRaw === 'string'
            ? String(domainsRaw)
                .split(/[\s,]+/)
                .filter(Boolean)
            : undefined;
        const edgeRaw = data.edgeNodeIds;
        const edgeNodeIds = Array.isArray(edgeRaw)
          ? (edgeRaw as string[])
          : typeof edgeRaw === 'string'
            ? String(edgeRaw)
                .split(/[\s,]+/)
                .filter(Boolean)
            : undefined;
        const origin =
          data.origin && typeof data.origin === 'object'
            ? (data.origin as {
                kind?: 'project' | 'url';
                projectId?: string;
                url?: string;
                sni?: string;
              })
            : undefined;
        const site = upsertCdnSite(ctx.db, {
          id: typeof data.id === 'string' ? data.id : undefined,
          name: String(data.name ?? ''),
          domains,
          mode: typeof data.mode === 'string' ? data.mode : undefined,
          origin: origin
            ? {
                kind: origin.kind === 'project' ? 'project' : 'url',
                projectId: origin.projectId,
                url: origin.url,
                sni: origin.sni,
              }
            : undefined,
          edgeNodeIds,
          originShieldNodeId:
            data.originShieldNodeId === null
              ? null
              : typeof data.originShieldNodeId === 'string'
                ? data.originShieldNodeId
                : undefined,
          dns:
            data.dns && typeof data.dns === 'object'
              ? (data.dns as Record<string, unknown>)
              : undefined,
          cache:
            data.cache && typeof data.cache === 'object'
              ? (data.cache as Record<string, unknown>)
              : undefined,
          ssl:
            data.ssl && typeof data.ssl === 'object'
              ? (data.ssl as Record<string, unknown>)
              : undefined,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.upsert',
          resource: site.id,
          detail: { name: site.name, domains: site.domains },
          ok: true,
        });
        sendJson(res, 200, { site });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/cdn/from-project') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          projectId?: string;
          edgeNodeIds?: string[];
          originShieldNodeId?: string;
          strategy?: string;
          mode?: string;
          geoMap?: Record<string, string[]>;
          geoSubdomains?: boolean;
          name?: string;
        };
        if (!data.projectId) {
          sendJson(res, 400, {
            ok: false,
            notes: [tl('notes.auto.n1569')],
          });
          return true;
        }
        const proj = ctx.projects.get(data.projectId);
        const { enableCdnFromProject } = await import('@ysk/core');
        const r = enableCdnFromProject({
          db: ctx.db,
          project: proj,
          edgeNodeIds: data.edgeNodeIds,
          originShieldNodeId: data.originShieldNodeId,
          strategy: data.strategy as import('@ysk/shared').CdnDnsStrategy | undefined,
          mode: data.mode as import('@ysk/shared').CdnSiteMode | undefined,
          geoMap: data.geoMap,
          geoSubdomains: data.geoSubdomains,
          name: data.name,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.from_project',
          resource: r.site.id,
          detail: {
            projectId: data.projectId,
            created: r.created,
            domains: r.site.domains,
          },
          ok: r.ok,
        });
        sendJson(res, r.created ? 201 : 200, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/cdn/health-loop') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { applyZone?: boolean };
        const { runAllCdnSitesHealthLoop } = await import('@ysk/core');
        const r = await runAllCdnSitesHealthLoop({
          db: ctx.db,
          dataDir: ctx.dataDir,
          host: ctx.host,
          applyZone: data.applyZone,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.health_loop_all',
          detail: { ok: r.ok, count: r.results.length },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/cdn/dashboard') {
        ctx.auth.authenticate(getBearer(req));
        const { collectCdnDashboard } = await import('@ysk/core');
        const dash = await collectCdnDashboard({
          db: ctx.db,
          dataDir: ctx.dataDir,
          host: ctx.host,
        });
        sendJson(res, 200, dash);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { getCdnSite, readCdnSiteRenderedConf } = await import('@ysk/core');
        const site = getCdnSite(ctx.db, id);
        if (!site) {
          sendJson(res, 404, { ok: false, notes: [tl('notes.auto.n0024')] });
          return true;
        }
        const rendered = readCdnSiteRenderedConf(ctx.dataDir, id);
        sendJson(res, 200, { site, rendered });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { deleteCdnSite } = await import('@ysk/core');
        const ok = deleteCdnSite(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.delete',
          resource: id,
          detail: { ok },
          ok });
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }

  return false;
}
