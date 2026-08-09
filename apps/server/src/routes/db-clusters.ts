/**
 * DB clusters dispatcher (Wave Q1).
 * crud → actions
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleDbClustersCrudRoutes } from './db-clusters-crud.js';
import { handleDbClustersActionsRoutes } from './db-clusters-actions.js';

export async function handleDbClustersRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleDbClustersCrudRoutes(ctx, req, res, url, method)) return true;
  if (await handleDbClustersActionsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
