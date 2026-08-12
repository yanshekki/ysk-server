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
        type Job = {
          id?: string;
          command?: string;
          schedule?: string;
          user?: string;
          projectId?: string;
          project_id?: string;
        };
        const all = ctx.cron.list(projectId) as unknown as Job[];
        const { items, meta } = listWithQuery(url, all, {
          text: (j: Job) => [
            String(j.id ?? ''),
            String(j.command ?? ''),
            String(j.schedule ?? ''),
            String(j.user ?? ''),
            String(j.projectId ?? j.project_id ?? ''),
          ],
        });
        sendJson(res, 200, { items, meta });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/cron/status') {
        ctx.auth.authenticate(getBearer(req));
        const status = await ctx.cron.probeInstallStatus();
        sendJson(res, 200, status);
        return true;
      }
      // Host crontab inventory (root + project linux users) — Terminal-style
      if (method === 'GET' && url.pathname === '/api/v1/cron/host') {
        ctx.auth.authenticate(getBearer(req));
        const projects = (ctx.db.snapshot.projects ?? []).map((p) => ({
          id: String(p.id ?? ''),
          name: String(p.name ?? p.id ?? ''),
          linuxUser: String(p.linux_user ?? ''),
          linux_user: String(p.linux_user ?? ''),
        }));
        const inv = await ctx.cron.listHostCrontabs(projects);
        sendJson(res, 200, inv);
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
      // DELETE / PATCH / run-now (moved from misc)
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/cron\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4] ?? '';
        const ok = ctx.cron.delete(id);
        ctx.audit.append({
          actor: user.username,
          action: 'cron.delete',
          resource: id,
          detail: { ok },
          ok,
        });
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/cron\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4] ?? '';
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { enabled?: boolean };
        if (typeof data.enabled !== 'boolean') {
          const { tl } = await import('ysk-server-shared');
          sendJson(res, 400, {
            ok: false,
            code: 'YSK_VALIDATION',
            message: tl('notes.auto.n1406'),
          });
          return true;
        }
        const job = ctx.cron.setEnabled(id, data.enabled);
        if (!job) {
          const { tl } = await import('ysk-server-shared');
          sendJson(res, 404, {
            ok: false,
            code: 'YSK_NOT_FOUND',
            message: tl('notes.auto.n0019'),
          });
          return true;
        }
        ctx.audit.append({
          actor: user.username,
          action: 'cron.set_enabled',
          resource: id,
          detail: { enabled: data.enabled },
          ok: true,
        });
        sendJson(res, 200, { job });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/cron\/[^/]+\/run$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4] ?? '';
        const result = await ctx.cron.runNow(id, user.username);
        ctx.audit.append({
          actor: user.username,
          action: 'cron.run_now',
          resource: id,
          detail: result,
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
  return false;
}
