/**
 * Hosting infra DNS dispatcher (Wave Z1).
 * zones → powerdns
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleHostingDnsZonesRoutes } from './hosting-dns-zones.js';
import { handleHostingDnsPowerdnsRoutes } from './hosting-dns-powerdns.js';

export async function handleHostingInfraDnsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleHostingDnsZonesRoutes(ctx, req, res, url, method)) return true;
  if (await handleHostingDnsPowerdnsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
