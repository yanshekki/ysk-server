import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
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
        type Node = {
          name?: string;
          id?: string;
          region?: string;
          baseUrl?: string;
          status?: string;
        };
        const all = listCdnNodes(ctx.db) as unknown as Node[];
        const { items, meta } = listWithQuery(url, all, {
          text: (n: Node) => [
            String(n.name ?? ''),
            String(n.id ?? ''),
            String(n.region ?? ''),
            String(n.baseUrl ?? ''),
            String(n.status ?? ''),
          ],
        });
        sendJson(res, 200, { items, meta });
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
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { getCdnNode } = await import('@ysk/core');
        const node = getCdnNode(ctx.db, id);
        if (!node) {
          sendJson(res, 404, { ok: false, notes: [tl('notes.auto.n0866')] });
          return true;
        }
        sendJson(res, 200, { node });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { deleteCdnNode } = await import('@ysk/core');
        const ok = deleteCdnNode(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.node.delete',
          resource: id,
          detail: { ok },
          ok });
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+\/probe$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { probeCdnNode } = await import('@ysk/core');
        const r = await probeCdnNode(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.node.probe',
          resource: id,
          detail: { ok: r.ok, method: r.method },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+\/drain$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { draining?: boolean };
        const { setCdnNodeDrain } = await import('@ysk/core');
        const node = setCdnNodeDrain(ctx.db, id, data.draining !== false);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.node.drain',
          resource: id,
          detail: { status: node.status },
          ok: true });
        sendJson(res, 200, { node });
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
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/render$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dryRun?: boolean;
          projectOriginUrl?: string;
        };
        const { applyCdnSiteEdgeRender } = await import('@ysk/core');
        const r = await applyCdnSiteEdgeRender({
          db: ctx.db,
          dataDir: ctx.dataDir,
          siteId: id,
          host: ctx.host,
          dryRun: data.dryRun === true,
          projectOriginUrl: data.projectOriginUrl });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.render',
          resource: id,
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            contentHash: r.contentHash,
            dryRun: data.dryRun === true },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/apply$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          edgeNodeId?: string;
          skipDraining?: boolean;
          projectOriginUrl?: string;
        };
        const { fanOutCdnSite } = await import('@ysk/core');
        const r = await fanOutCdnSite({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId: id,
          edgeNodeId: data.edgeNodeId,
          skipDraining: data.skipDraining,
          projectOriginUrl: data.projectOriginUrl,
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload) });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.apply',
          resource: id,
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            edges: r.edges?.length },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/purge$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          edgeNodeId?: string;
          skipDraining?: boolean;
        };
        const { purgeCdnSite } = await import('@ysk/core');
        const r = await purgeCdnSite({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId: id,
          edgeNodeId: data.edgeNodeId,
          skipDraining: data.skipDraining,
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload) });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.purge',
          resource: id,
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            edges: r.edges?.length },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/dns-sync$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          probeFirst?: boolean;
          applyZone?: boolean;
        };
        const { syncCdnSiteDns } = await import('@ysk/core');
        const r = await syncCdnSiteDns({
          db: ctx.db,
          dataDir: ctx.dataDir,
          siteId: id,
          host: ctx.host,
          probeFirst: data.probeFirst,
          applyZone: data.applyZone });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.dns_sync',
          resource: id,
          detail: {
            ok: r.ok,
            strategy: r.strategy,
            ipv4: r.selectedIpv4,
            recordsTouched: r.recordsTouched },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'GET' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/dns-records$/)
      ) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { listCdnManagedDnsRecords } = await import('@ysk/core');
        sendJson(res, 200, {
          items: listCdnManagedDnsRecords(ctx.db, id) });
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/ssl\/distribute$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          applyNginx?: boolean;
          edgeNodeId?: string;
          skipDraining?: boolean;
        };
        const { distributeCdnSiteSsl } = await import('@ysk/core');
        const r = await distributeCdnSiteSsl({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId: id,
          applyNginx: data.applyNginx,
          edgeNodeId: data.edgeNodeId,
          skipDraining: data.skipDraining,
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload) });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.ssl_distribute',
          resource: id,
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            domain: r.cert?.domain },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/ssl\/issue$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          email?: string;
          run?: boolean;
          distribute?: boolean;
        };
        const { issueCdnSiteLetsEncrypt } = await import('@ysk/core');
        const r = await issueCdnSiteLetsEncrypt({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId: id,
          email: data.email ?? '',
          run: data.run,
          distribute: data.distribute,
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload) });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.ssl_issue',
          resource: id,
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            executed: r.executed },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/ssl\/prepare-acme$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { prepareCdnSiteAcme } = await import('@ysk/core');
        const r = await prepareCdnSiteAcme({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId: id,
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload) });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.ssl_prepare_acme',
          resource: id,
          detail: { ok: r.ok, apply_status: r.apply_status },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }

  return false;
}
