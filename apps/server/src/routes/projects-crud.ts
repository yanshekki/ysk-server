/**
 * Projects CRUD dispatcher (Wave T3).
 * isolation → catalog
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleProjectsIsolationRoutes } from './projects-isolation.js';
import { handleProjectsCatalogRoutes } from './projects-catalog.js';

export async function handleProjectsCrudRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleProjectsIsolationRoutes(ctx, req, res, url, method)) return true;
  if (await handleProjectsCatalogRoutes(ctx, req, res, url, method)) return true;
  return false;
}
