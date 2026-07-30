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

export async function handleCronRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/cron') {
        ctx.auth.authenticate(getBearer(req));
        const projectId = url.searchParams.get('projectId') ?? undefined;
        sendJson(res, 200, { items: ctx.cron.list(projectId) });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/cron/status') {
        ctx.auth.authenticate(getBearer(req));
        const status = await ctx.cron.probeInstallStatus();
        sendJson(res, 200, status);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/cron') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          projectId?: string;
          user?: string;
          schedule?: string;
          command?: string;
        };
        const job = ctx.cron.create({
          projectId: data.projectId,
          user: data.user ?? 'ysk',
          schedule: data.schedule ?? '0 3 * * *',
          command: data.command ?? 'true',
          actor: user.username,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'cron.create',
          resource: job.id,
          detail: job,
          ok: true,
        });
        sendJson(res, 201, { job });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/cron/install') {
        const user = ctx.auth.authenticate(getBearer(req));
        const result = await ctx.cron.installCrontab(user.username);
        ctx.audit.append({
          actor: user.username,
          action: 'cron.install',
          detail: result,
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
  return false;
}
