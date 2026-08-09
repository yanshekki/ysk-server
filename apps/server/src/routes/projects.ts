/**
 * Projects routes dispatcher (Wave H3).
 * lifecycle → ops → crud
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleProjectsLifecycleRoutes } from './projects-lifecycle.js';
import { handleProjectsOpsRoutes } from './projects-ops.js';
import { handleProjectsCrudRoutes } from './projects-crud.js';

export async function handleProjectsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleProjectsLifecycleRoutes(ctx, req, res, url, method)) return true;
  if (await handleProjectsOpsRoutes(ctx, req, res, url, method)) return true;
  if (await handleProjectsCrudRoutes(ctx, req, res, url, method)) return true;
  return false;
}
