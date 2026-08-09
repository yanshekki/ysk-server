/**
 * Metrics dispatcher (Wave AB3).
 * Path-gated: read → ops
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleMetricsReadRoutes } from './metrics-read.js';
import { handleMetricsOpsRoutes } from './metrics-ops.js';

export async function handleMetricsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/metrics')) return false;
  if (await handleMetricsReadRoutes(ctx, req, res, url, method)) return true;
  if (await handleMetricsOpsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
