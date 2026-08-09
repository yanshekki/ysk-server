/**
 * Runtime plugins dispatcher (Wave W3).
 * addons → plugin-ops
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleHostingRuntimesAddonsRoutes } from './hosting-runtimes-addons.js';
import { handleHostingRuntimesPluginOpsRoutes } from './hosting-runtimes-plugin-ops.js';

export async function handleHostingRuntimesPluginsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleHostingRuntimesAddonsRoutes(ctx, req, res, url, method)) return true;
  if (await handleHostingRuntimesPluginOpsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
