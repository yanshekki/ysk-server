/**
 * System apply stack dispatcher (Wave Y3).
 * tls → web
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSystemApplyTlsRoutes } from './system-apply-tls.js';
import { handleSystemApplyWebRoutes } from './system-apply-web.js';

export async function handleSystemApplyStackRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSystemApplyTlsRoutes(ctx, req, res, url, method)) return true;
  if (await handleSystemApplyWebRoutes(ctx, req, res, url, method)) return true;
  return false;
}
