/**
 * Project lifecycle dispatcher (Wave AB1).
 * deploy → os-user
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleProjectsDeployRoutes } from './projects-deploy.js';
import { handleProjectsOsUserRoutes } from './projects-os-user.js';

export async function handleProjectsLifecycleRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleProjectsDeployRoutes(ctx, req, res, url, method)) return true;
  if (await handleProjectsOsUserRoutes(ctx, req, res, url, method)) return true;
  return false;
}
