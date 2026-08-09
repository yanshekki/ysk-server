/**
 * System Log Center dispatcher — /api/v1/logs/* (Wave Q3).
 * read → ops
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleLogsReadRoutes } from './logs-read.js';
import { handleLogsOpsRoutes } from './logs-ops.js';

export async function handleLogsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/logs')) return false;
  if (await handleLogsReadRoutes(ctx, req, res, url, method)) return true;
  if (await handleLogsOpsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
