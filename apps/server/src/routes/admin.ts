/**
 * Admin routes dispatcher (Wave L2).
 * users → packages
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleAdminUsersRoutes } from './admin-users.js';
import { handleAdminPackagesRoutes } from './admin-packages.js';

export async function handleAdminRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleAdminUsersRoutes(ctx, req, res, url, method)) return true;
  if (await handleAdminPackagesRoutes(ctx, req, res, url, method)) return true;
  return false;
}
