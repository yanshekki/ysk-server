/**
 * DB routes dispatcher (Wave M1).
 * access → clusters
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleDbAccessRoutes } from './db-access.js';
import { handleDbClustersRoutes } from './db-clusters.js';

export async function handleDbRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleDbAccessRoutes(ctx, req, res, url, method)) return true;
  if (await handleDbClustersRoutes(ctx, req, res, url, method)) return true;
  return false;
}
