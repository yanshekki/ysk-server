/**
 * Project deploy / stop / publish / suspend (Wave AB1).
 * Extracted from projects-lifecycle.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@yanshekki/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleProjectsDeployRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (
    method === 'GET' &&
    url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy-history$/)
  ) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const limit = Math.min(50, Number(url.searchParams.get('limit') ?? 20) || 20);
    const items = ctx.audit.listForResource(id, {
      actionPrefix: 'project.deploy',
      limit });
    // Also include process deploys recorded as project.deploy_process / deploy_node / deploy_php
    const more = ctx.audit
      .listForResource(id, { limit: 80 })
      .filter((e) =>
        /deploy|git_deploy/.test(e.action),
      )
      .slice(0, limit);
    const merged = [...items, ...more]
      .filter(
        (e, i, arr) => arr.findIndex((x) => x.id === e.id) === i,
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, limit);
    sendJson(res, 200, { items: merged });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/template$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { templateId?: string; force?: boolean };
    const result = ctx.projects.applyTemplate(
      id,
      data.templateId ?? 'node-starter',
      user.username,
      data.force,
    );
    sendJson(res, 200, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      port?: number;
      entry?: string;
      skipBuild?: boolean;
      nodeVersion?: string;
      enableSystemd?: boolean;
      preferFpm?: boolean;
      forceBuiltin?: boolean;
      ssl?: boolean;
      reload?: boolean;
    };
    const proj = ctx.projects.get(id);
    const processRuntimes = new Set([
      'python',
      'go',
      'rust',
      'java',
      'kotlin',
      'bun',
    ]);
    const result =
      proj.runtime === 'php'
        ? await ctx.projectOps.deployPhp(id, {
            actor: user.username,
            port: data.port,
            preferFpm: data.preferFpm,
            forceBuiltin: data.forceBuiltin })
        : proj.runtime === 'static'
          ? await ctx.projectOps.deployStatic(id, {
              actor: user.username,
              ssl: data.ssl,
              reload: data.reload })
          : processRuntimes.has(proj.runtime)
            ? await ctx.projectOps.deployProcess(id, {
                actor: user.username,
                port: data.port,
                entry: data.entry,
                skipBuild: data.skipBuild })
            : await ctx.projectOps.deployNode(id, {
                actor: user.username,
                port: data.port,
                entry: data.entry,
                nodeVersion: data.nodeVersion,
                enableSystemd: data.enableSystemd });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy-static$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ssl?: boolean; reload?: boolean };
    const result = await ctx.projectOps.deployStatic(id, {
      actor: user.username,
      ssl: data.ssl,
      reload: data.reload });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/stop$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const result = await ctx.projectOps.stopNode(id, user.username);
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/publish-nginx$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      systemConfDir?: string;
      ssl?: boolean;
      forceHttps?: boolean;
      hsts?: boolean;
    };
    const result = await ctx.projectOps.publishNginx(id, {
      actor: user.username,
      systemConfDir: data.systemConfDir,
      ssl: data.ssl,
      forceHttps: data.forceHttps,
      hsts: data.hsts });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/purge-cache$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const { purgeNginxCache } = await import('@yanshekki/core');
    const r = await purgeNginxCache({ host: ctx.host });
    ctx.audit.append({
      actor: user.username,
      action: 'project.purge_cache',
      resource: id,
      detail: r,
      ok: r.ok });
    sendOpsResult(res, {
      ...r,
      projectId: id,
      notes: [
        ...r.notes,
        tl('notes.auto.n0695'),
      ] });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/suspend$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const result = await ctx.projectOps.suspend(id, user.username);
    sendJson(res, 200, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/unsuspend$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const result = await ctx.projectOps.unsuspend(id, user.username);
    sendJson(res, 200, result);
    return true;
  }

  return false;
}
