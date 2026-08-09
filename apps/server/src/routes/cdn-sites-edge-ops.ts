/**
 * CDN site edge render/apply/purge/dns (Wave AB2).
 * Extracted from cdn-sites-edge.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleCdnSitesEdgeOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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

  return false;
}
