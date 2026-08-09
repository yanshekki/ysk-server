/**
 * Hosting infra dispatcher (Wave O2).
 * dns → services
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleHostingInfraDnsRoutes } from './hosting-infra-dns.js';
import { handleHostingInfraServicesRoutes } from './hosting-infra-services.js';

export async function handleHostingInfraRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleHostingInfraDnsRoutes(ctx, req, res, url, method)) return true;
  if (await handleHostingInfraServicesRoutes(ctx, req, res, url, method)) return true;
  return false;
}
