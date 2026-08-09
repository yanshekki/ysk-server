/**
 * Agents / fleet dispatcher (Wave X3).
 * fleet → runtimes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleAgentsFleetRoutes } from './agents-fleet.js';
import { handleAgentsRuntimesRoutes } from './agents-runtimes.js';

export async function handleAgentsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleAgentsFleetRoutes(ctx, req, res, url, method)) return true;
  if (await handleAgentsRuntimesRoutes(ctx, req, res, url, method)) return true;
  return false;
}
