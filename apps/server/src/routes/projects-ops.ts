/**
 * Project ops dispatcher (Wave N3).
 * runtime → data
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleProjectsOpsRuntimeRoutes } from './projects-ops-runtime.js';
import { handleProjectsOpsDataRoutes } from './projects-ops-data.js';

export async function handleProjectsOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleProjectsOpsRuntimeRoutes(ctx, req, res, url, method)) return true;
  if (await handleProjectsOpsDataRoutes(ctx, req, res, url, method)) return true;
  return false;
}
