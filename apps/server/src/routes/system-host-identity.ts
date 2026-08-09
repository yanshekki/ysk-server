/**
 * System host identity dispatcher (Wave R3).
 * core → panel
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSystemHostIdentityCoreRoutes } from './system-host-identity-core.js';
import { handleSystemHostPanelRoutes } from './system-host-panel.js';

export async function handleSystemHostIdentityRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSystemHostIdentityCoreRoutes(ctx, req, res, url, method)) return true;
  if (await handleSystemHostPanelRoutes(ctx, req, res, url, method)) return true;
  return false;
}
