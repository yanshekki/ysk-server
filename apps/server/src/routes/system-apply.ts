/**
 * System apply dispatcher (Wave R1).
 * stack → services
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSystemApplyStackRoutes } from './system-apply-stack.js';
import { handleSystemApplyServicesRoutes } from './system-apply-services.js';

export async function handleSystemApplyRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSystemApplyStackRoutes(ctx, req, res, url, method)) return true;
  if (await handleSystemApplyServicesRoutes(ctx, req, res, url, method)) return true;
  return false;
}
