/**
 * DB clusters actions dispatcher (Wave Y1).
 * lifecycle → fleet
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleDbClustersLifecycleRoutes } from './db-clusters-lifecycle.js';
import { handleDbClustersFleetRoutes } from './db-clusters-fleet.js';

export async function handleDbClustersActionsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleDbClustersLifecycleRoutes(ctx, req, res, url, method)) return true;
  if (await handleDbClustersFleetRoutes(ctx, req, res, url, method)) return true;
  return false;
}
