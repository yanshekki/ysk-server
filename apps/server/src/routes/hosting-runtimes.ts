/**
 * Hosting runtimes dispatcher (Wave N2).
 * core → php/tuning
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleHostingRuntimesCoreRoutes } from './hosting-runtimes-core.js';
import { handleHostingRuntimesPhpRoutes } from './hosting-runtimes-php.js';

export async function handleHostingRuntimesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleHostingRuntimesCoreRoutes(ctx, req, res, url, method)) return true;
  if (await handleHostingRuntimesPhpRoutes(ctx, req, res, url, method)) return true;
  return false;
}
