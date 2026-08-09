/**
 * Updates routes dispatcher (Wave K1).
 * inventory → apply → scheduler
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  sendJson,
} from '../http/util.js';
import { handleUpdatesInventoryRoutes } from './updates-inventory.js';
import { handleUpdatesApplyRoutes } from './updates-apply.js';

export async function handleUpdatesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleUpdatesInventoryRoutes(ctx, req, res, url, method)) return true;
  if (await handleUpdatesApplyRoutes(ctx, req, res, url, method)) return true;
      if (method === 'GET' && url.pathname === '/api/v1/scheduler') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, { jobs: ctx.scheduler.list() });
        return true;
      }

  return false;
}
