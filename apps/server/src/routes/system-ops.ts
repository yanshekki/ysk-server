/**
 * System ops dispatcher (Wave L1).
 * apply → migrate
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSystemApplyRoutes } from './system-apply.js';
import { handleSystemMigrateRoutes } from './system-migrate.js';

export async function handleSystemOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // Historical contract: system/* + updates/self/apply + ssl/letsencrypt alias
  if (
    !url.pathname.startsWith('/api/v1/system/') &&
    url.pathname !== '/api/v1/updates/self/apply' &&
    url.pathname !== '/api/v1/ssl/letsencrypt'
  ) {
    return false;
  }
  if (await handleSystemApplyRoutes(ctx, req, res, url, method)) return true;
  if (await handleSystemMigrateRoutes(ctx, req, res, url, method)) return true;
  return false;
}
