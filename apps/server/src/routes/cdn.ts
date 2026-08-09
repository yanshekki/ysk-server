/**
 * CDN routes dispatcher (Wave K3).
 * nodes → sites
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleCdnNodesRoutes } from './cdn-nodes.js';
import { handleCdnSitesRoutes } from './cdn-sites.js';

export async function handleCdnRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleCdnNodesRoutes(ctx, req, res, url, method)) return true;
  if (await handleCdnSitesRoutes(ctx, req, res, url, method)) return true;
  return false;
}
