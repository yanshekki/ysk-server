/**
 * System host routes dispatcher (Wave M3).
 * net → identity
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSystemHostNetRoutes } from './system-host-net.js';
import { handleSystemHostIdentityRoutes } from './system-host-identity.js';

export async function handleSystemHostRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSystemHostNetRoutes(ctx, req, res, url, method)) return true;
  if (await handleSystemHostIdentityRoutes(ctx, req, res, url, method)) return true;
  return false;
}
