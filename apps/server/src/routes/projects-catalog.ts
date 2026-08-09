/**
 * Projects catalog dispatcher (Wave Z2).
 * create → list (mutations before generic :id GET)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleProjectsCreateRoutes } from './projects-create.js';
import { handleProjectsListRoutes } from './projects-list.js';

export async function handleProjectsCatalogRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleProjectsCreateRoutes(ctx, req, res, url, method)) return true;
  if (await handleProjectsListRoutes(ctx, req, res, url, method)) return true;
  return false;
}
