/**
 * Hosting runtimes core dispatcher (Wave P1).
 * install → plugins
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleHostingRuntimesInstallRoutes } from './hosting-runtimes-install.js';
import { handleHostingRuntimesPluginsRoutes } from './hosting-runtimes-plugins.js';

export async function handleHostingRuntimesCoreRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleHostingRuntimesInstallRoutes(ctx, req, res, url, method)) return true;
  if (await handleHostingRuntimesPluginsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
