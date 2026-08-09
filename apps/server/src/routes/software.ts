/**
 * Software routes dispatcher (Wave U2).
 * catalog → stack
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSoftwareCatalogRoutes } from './software-catalog.js';
import { handleSoftwareStackRoutes } from './software-stack.js';

export async function handleSoftwareRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSoftwareCatalogRoutes(ctx, req, res, url, method)) return true;
  if (await handleSoftwareStackRoutes(ctx, req, res, url, method)) return true;
  return false;
}
