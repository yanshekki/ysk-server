/**
 * Project edge ops — network / nginx-conf / web-stats (Wave V1).
 * Extracted from projects-ops-runtime.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
} from '../http/util.js';

export async function handleProjectsOpsEdgeRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/network$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      domainAliases?: string[];
      forceHttps?: boolean;
      hsts?: boolean;
      siteRedirectUrl?: string | null;
      httpAuthUser?: string | null;
      httpAuthPass?: string | null;
      docRoot?: string | null;
      bindIp?: string | null;
      realIpProvider?: string | null;
      preferredPort?: number | null;
      publish?: boolean;
      ssl?: boolean;
    };
    const project = ctx.projects.updateNetwork(
      id,
      {
        domain: data.domain,
        domainAliases: data.domainAliases,
        forceHttps: data.forceHttps,
        hsts: data.hsts,
        siteRedirectUrl: data.siteRedirectUrl,
        httpAuthUser: data.httpAuthUser,
        httpAuthPass: data.httpAuthPass,
        docRoot: data.docRoot,
        bindIp: data.bindIp,
        realIpProvider: data.realIpProvider,
        preferredPort: data.preferredPort,
      },
      user.username,
    );
    if (data.publish) {
      const pub = await ctx.projectOps.publishNginx(id, {
        actor: user.username,
        ssl: data.ssl,
        forceHttps: data.forceHttps ?? project.forceHttps,
        hsts: data.hsts ?? project.hsts });
      sendJson(res, 200, { project, publish: pub });
      return true;
    }
    sendJson(res, 200, { project });
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/nginx-conf$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const proj = ctx.projects.get(id);
    const path = proj.nginxConfigPath;
    if (!path) {
      sendJson(res, 200, { content: '', path: null });
      return true;
    }
    try {
      const { readFileSync, existsSync } = await import('node:fs');
      const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
      sendJson(res, 200, { content, path });
    } catch (e) {
      sendJson(res, 200, {
        content: '',
        path,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/web-stats$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const proj = ctx.projects.get(id);
    const { collectProjectWebStats, recordProjectDailyStats, readProjectDailyStats } =
      await import('@ysk-server/core');
    const stats = await collectProjectWebStats({
      host: ctx.host,
      dataDir: ctx.dataDir,
      projectId: id,
      homeDir: proj.homeDir,
      linuxUser: proj.linuxUser });
    const daily = recordProjectDailyStats(ctx.dataDir, id, stats);
    sendJson(res, 200, {
      ...stats,
      daily: daily.series,
      history: readProjectDailyStats(ctx.dataDir, id) });
    return true;
  }

  return false;
}
