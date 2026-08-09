/**
 * Defense routes dispatcher (Wave M2).
 * center → geoip
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleDefenseCenterRoutes } from './defense-center.js';
import { handleDefenseGeoipRoutes } from './defense-geoip.js';

export async function handleDefenseRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleDefenseCenterRoutes(ctx, req, res, url, method)) return true;
  if (await handleDefenseGeoipRoutes(ctx, req, res, url, method)) return true;
  return false;
}
