/**
 * Project OS user provision / limits / chown / migrate (Wave AB1).
 * Extracted from projects-lifecycle.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleProjectsOsUserRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-provision$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const result = await ctx.projects.provisionOsIsolation(id, user.username);
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const result = await ctx.projectOps.getOsUser(id);
    sendJson(res, 200, result);
    return true;
  }
  if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      shell?: string;
      accountLocked?: boolean;
      memoryMax?: string;
      cpuQuotaPercent?: number;
      tasksMax?: number;
      limitNofile?: number;
      quotaMb?: number;
    };
    const result = await ctx.projectOps.patchOsUser(id, data, user.username);
    sendJson(res, result.ok || result.written ? 200 : 422, result);
    return true;
  }
  if (
    method === 'POST' &&
    url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user\/apply-limits$/)
  ) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const result = await ctx.projectOps.applyOsLimits(id, user.username);
    sendJson(res, result.ok || result.written ? 200 : 422, result);
    return true;
  }
  if (
    method === 'POST' &&
    url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user\/chown-home$/)
  ) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const result = await ctx.projectOps.chownOsHome(id, user.username);
    sendOpsResult(res, result);
    return true;
  }
  if (
    method === 'POST' &&
    url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user\/migrate$/)
  ) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { removePreviousHome?: boolean };
    const result = await ctx.projects.migrateOsIsolation(id, user.username, {
      removePreviousHome: data.removePreviousHome !== false });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
