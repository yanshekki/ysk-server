/**
 * CDN site SSL distribute / issue / prepare-acme (Wave AB2).
 * Extracted from cdn-sites-edge.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendOpsResult,
} from '../http/util.js';

export async function handleCdnSitesSslRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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
    const { distributeCdnSiteSsl } = await import('@yanshekki/core');
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
    const { issueCdnSiteLetsEncrypt } = await import('@yanshekki/core');
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
    const { prepareCdnSiteAcme } = await import('@yanshekki/core');
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
