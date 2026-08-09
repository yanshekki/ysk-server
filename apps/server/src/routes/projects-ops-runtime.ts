/**
 * Project runtime ops dispatcher (Wave V1).
 * edge → deploy
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleProjectsOpsEdgeRoutes } from './projects-ops-edge.js';
import { handleProjectsOpsDeployRoutes } from './projects-ops-deploy.js';

export async function handleProjectsOpsRuntimeRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleProjectsOpsEdgeRoutes(ctx, req, res, url, method)) return true;
  if (await handleProjectsOpsDeployRoutes(ctx, req, res, url, method)) return true;
  return false;
}
