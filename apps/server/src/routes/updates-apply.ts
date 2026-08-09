/**
 * Updates apply dispatcher (Wave Q2).
 * single → batch
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleUpdatesApplySingleRoutes } from './updates-apply-single.js';
import { handleUpdatesApplyBatchRoutes } from './updates-apply-batch.js';

export async function handleUpdatesApplyRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleUpdatesApplySingleRoutes(ctx, req, res, url, method)) return true;
  if (await handleUpdatesApplyBatchRoutes(ctx, req, res, url, method)) return true;
  return false;
}
