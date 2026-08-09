/**
 * DNS routes dispatcher (Wave X2).
 * cluster → tools
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleDnsClusterRoutes } from './dns-cluster.js';
import { handleDnsToolsRoutes } from './dns-tools.js';

export async function handleDnsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleDnsClusterRoutes(ctx, req, res, url, method)) return true;
  if (await handleDnsToolsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
