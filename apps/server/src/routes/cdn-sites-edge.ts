/**
 * CDN sites edge dispatcher (Wave AB2).
 * edge-ops → ssl
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleCdnSitesEdgeOpsRoutes } from './cdn-sites-edge-ops.js';
import { handleCdnSitesSslRoutes } from './cdn-sites-ssl.js';

export async function handleCdnSitesEdgeRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleCdnSitesEdgeOpsRoutes(ctx, req, res, url, method)) return true;
  if (await handleCdnSitesSslRoutes(ctx, req, res, url, method)) return true;
  return false;
}
