import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleCdnRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      // —— CDN nodes (PR-C1): registry + probe + drain ——
      if (method === 'GET' && url.pathname === '/api/v1/cdn/nodes') {
        ctx.auth.authenticate(getBearer(req));
        const { listCdnNodes } = await import('@ysk/core');
        sendJson(res, 200, { items: listCdnNodes(ctx.db) });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/cdn/nodes') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as Record<string, unknown>;
        const { upsertCdnNode } = await import('@ysk/core');
        const node = upsertCdnNode(ctx.db, {
          id: typeof data.id === 'string' ? data.id : undefined,
          name: String(data.name ?? ''),
          baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : undefined,
          fleetAgentId:
            typeof data.fleetAgentId === 'string' ? data.fleetAgentId : undefined,
          sshIdentityId:
            typeof data.sshIdentityId === 'string' ? data.sshIdentityId : undefined,
          sshHost: typeof data.sshHost === 'string' ? data.sshHost : undefined,
          sshPort:
            typeof data.sshPort === 'number'
              ? data.sshPort
              : Number(data.sshPort) || undefined,
          sshUsername:
            typeof data.sshUsername === 'string' ? data.sshUsername : undefined,
          remoteNginxConfDir:
            typeof data.remoteNginxConfDir === 'string'
              ? data.remoteNginxConfDir
              : undefined,
          roles: Array.isArray(data.roles) ? (data.roles as string[]) : undefined,
          region: typeof data.region === 'string' ? data.region : undefined,
          publicIpv4: Array.isArray(data.publicIpv4)
            ? (data.publicIpv4 as string[])
            : typeof data.publicIpv4 === 'string'
              ? String(data.publicIpv4)
                  .split(/[\s,]+/)
                  .filter(Boolean)
              : undefined,
          publicIpv6: Array.isArray(data.publicIpv6)
            ? (data.publicIpv6 as string[])
            : typeof data.publicIpv6 === 'string'
              ? String(data.publicIpv6)
                  .split(/[\s,]+/)
                  .filter(Boolean)
              : undefined,
          healthUrl: typeof data.healthUrl === 'string' ? data.healthUrl : undefined,
          weight: typeof data.weight === 'number' ? data.weight : Number(data.weight) || undefined,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.node.upsert',
          resource: node.id,
          detail: { name: node.name, roles: node.roles },
          ok: true,
        });
        sendJson(res, 200, { node });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/cdn/nodes/probe-all') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { probeAllCdnNodes } = await import('@ysk/core');
        const r = await probeAllCdnNodes(ctx.db);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.nodes.probe_all',
          detail: { ok: r.ok, count: r.items.length },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      // —— CDN sites (PR-C2): policy + edge nginx render (written, not fan-out) ——
      if (method === 'GET' && url.pathname === '/api/v1/cdn/sites') {
        ctx.auth.authenticate(getBearer(req));
        const { listCdnSites } = await import('@ysk/core');
        sendJson(res, 200, { items: listCdnSites(ctx.db) });
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
  return false;
}
