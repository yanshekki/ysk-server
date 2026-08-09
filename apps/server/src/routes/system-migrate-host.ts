/**
 * Host migrate dispatcher (Wave X1).
 * jobs → readiness
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSystemMigrateJobsRoutes } from './system-migrate-jobs.js';
import { handleSystemReadinessRoutes } from './system-readiness.js';

export async function handleSystemMigrateHostRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSystemMigrateJobsRoutes(ctx, req, res, url, method)) return true;
  if (await handleSystemReadinessRoutes(ctx, req, res, url, method)) return true;
  return false;
}
