/**
 * Admin users dispatcher (Wave AA2).
 * list → ops
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleAdminUsersListRoutes } from './admin-users-list.js';
import { handleAdminUsersOpsRoutes } from './admin-users-ops.js';

export async function handleAdminUsersRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleAdminUsersListRoutes(ctx, req, res, url, method)) return true;
  if (await handleAdminUsersOpsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
