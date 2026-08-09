/**
 * CDN sites dispatcher (Wave O3).
 * crud → edge
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleCdnSitesCrudRoutes } from './cdn-sites-crud.js';
import { handleCdnSitesEdgeRoutes } from './cdn-sites-edge.js';

export async function handleCdnSitesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleCdnSitesCrudRoutes(ctx, req, res, url, method)) return true;
  if (await handleCdnSitesEdgeRoutes(ctx, req, res, url, method)) return true;
  return false;
}
