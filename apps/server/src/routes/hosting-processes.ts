/**
 * Hosting process fleet — PM2 + YSK project process control / SSE.
 * Extracted from hosting.ts (Wave G1). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
} from '../http/util.js';

export async function handleHostingProcessesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      // —— PM2 + YSK project process fleet (Node/Bun Processes tab) ——
      if (method === 'GET' && url.pathname === '/api/v1/hosting/pm2/status') {
        ctx.auth.authenticate(getBearer(req));
        const { collectPm2Snapshot } = await import('@ysk/core');
        const snap = await collectPm2Snapshot(ctx.host);
        sendJson(res, 200, snap);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/pm2/startup') {
        ctx.auth.authenticate(getBearer(req));
        const { probePm2Startup } = await import('@ysk/core');
        sendJson(res, 200, await probePm2Startup(ctx.host));
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/pm2/startup') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as { action?: string };
        const action = body.action || 'install';
        if (action === 'save') {
          const { applyPm2Save } = await import('@ysk/core');
          sendJson(res, 200, await applyPm2Save(ctx.host));
          return true;
        }
        if (action === 'install') {
          const { applyPm2StartupInstall } = await import('@ysk/core');
          sendJson(res, 200, await applyPm2StartupInstall(ctx.host));
          return true;
        }
        sendJson(res, 400, {
          error: { code: 'VALIDATION', message: 'action must be install|save' },
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/pm2/action') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as {
          action?: string;
          name?: string;
          appName?: string;
        };
        const action = body.action;
        const name = String(body.name || body.appName || '').trim();
        if (
          action !== 'restart' &&
          action !== 'reload' &&
          action !== 'stop' &&
          action !== 'delete'
        ) {
          sendJson(res, 400, {
            error: { code: 'VALIDATION', message: 'action must be restart|reload|stop|delete' },
          });
          return true;
        }
        if (!name) {
          sendJson(res, 400, {
            error: { code: 'VALIDATION', message: 'name required' },
          });
          return true;
        }
        const { applyPm2AppAction } = await import('@ysk/core');
        const result = await applyPm2AppAction({
          host: ctx.host,
          appName: name,
          action,
        });
        // Always 200 with ok flag — Processes tab needs notes on blocked/fail
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/process-fleet') {
        ctx.auth.authenticate(getBearer(req));
        const { collectProcessFleet } = await import('@ysk/core');
        const runtimes = (url.searchParams.get('runtimes') || 'node,bun')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const fleet = await collectProcessFleet(ctx.host, ctx.db, { runtimes });
        sendJson(res, 200, fleet);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/process-fleet/systemd-action') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as {
          action?: string;
          projectId?: string;
        };
        const action = body.action;
        const projectId = String(body.projectId || '').trim();
        if (action !== 'restart' && action !== 'stop') {
          sendJson(res, 400, {
            error: { code: 'VALIDATION', message: 'action must be restart|stop' },
          });
          return true;
        }
        if (!projectId) {
          sendJson(res, 400, {
            error: { code: 'VALIDATION', message: 'projectId required' },
          });
          return true;
        }
        const { applySystemdProjectAction } = await import('@ysk/core');
        const result = await applySystemdProjectAction({
          host: ctx.host,
          db: ctx.db,
          projectId,
          action,
        });
        sendJson(res, 200, result);
        return true;
      }
      if (
        method === 'GET' &&
        (url.pathname === '/api/v1/hosting/pm2/stream' ||
          url.pathname === '/api/v1/hosting/process-fleet/stream')
      ) {
        ctx.auth.authenticate(getBearer(req));
        const { collectProcessFleet } = await import('@ysk/core');
        const intervalSec = Math.max(
          1,
          Math.min(10, Number(url.searchParams.get('interval') || 2)),
        );
        const runtimes = (url.searchParams.get('runtimes') || 'node,bun')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const useFleet = url.pathname.includes('process-fleet');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(`: ysk-process-fleet-stream\n\n`);
        let closed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const maxTicks = Math.min(300, Math.floor((10 * 60) / intervalSec));
        let ticks = 0;
        const send = (event: string, data: unknown) => {
          if (closed || res.writableEnded) return;
          try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          } catch {
            closed = true;
          }
        };
        const tick = async () => {
          if (closed) return;
          ticks += 1;
          try {
            const fleet = await collectProcessFleet(ctx.host, ctx.db, { runtimes });
            // Legacy pm2/stream clients expect Pm2Snapshot shape
            send('tick', useFleet ? fleet : fleet.pm2);
          } catch (e) {
            send('error', {
              message: e instanceof Error ? e.message : 'process fleet stream error',
            });
          }
          if (ticks >= maxTicks) {
            send('end', { reason: 'max_duration' });
            closed = true;
            try {
              res.end();
            } catch {
              /* */
            }
            return;
          }
          if (!closed) {
            timer = setTimeout(() => void tick(), intervalSec * 1000);
          }
        };
        req.on('close', () => {
          closed = true;
          if (timer) clearTimeout(timer);
        });
        void tick();
        return true;
      }

  return false;
}
