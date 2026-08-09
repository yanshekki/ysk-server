/**
 * Host network dispatcher (Wave Y2).
 * Path-gated: ifaces → routing
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleNetworkIfacesRoutes } from './network-ifaces.js';
import { handleNetworkRoutingRoutes } from './network-routing.js';

export async function handleNetworkRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/network')) return false;
  if (await handleNetworkIfacesRoutes(ctx, req, res, url, method)) return true;
  if (await handleNetworkRoutingRoutes(ctx, req, res, url, method)) return true;
  return false;
}
