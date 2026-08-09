/**
 * Hosting routes dispatcher (Wave G3).
 * processes → runtimes → infra
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleHostingProcessesRoutes } from './hosting-processes.js';
import { handleHostingRuntimesRoutes } from './hosting-runtimes.js';
import { handleHostingInfraRoutes } from './hosting-infra.js';

export async function handleHostingRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleHostingProcessesRoutes(ctx, req, res, url, method)) return true;
  if (await handleHostingRuntimesRoutes(ctx, req, res, url, method)) return true;
  if (await handleHostingInfraRoutes(ctx, req, res, url, method)) return true;
  return false;
}
