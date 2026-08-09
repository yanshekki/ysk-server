/**
 * Project data ops dispatcher (Wave V3).
 * logs → quota
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleProjectsOpsLogsRoutes } from './projects-ops-logs.js';
import { handleProjectsOpsQuotaRoutes } from './projects-ops-quota.js';

export async function handleProjectsOpsDataRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleProjectsOpsLogsRoutes(ctx, req, res, url, method)) return true;
  if (await handleProjectsOpsQuotaRoutes(ctx, req, res, url, method)) return true;
  return false;
}
