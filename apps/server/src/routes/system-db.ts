/**
 * System DB routes dispatcher (Wave N1).
 * engines → redis
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSystemDbEnginesRoutes } from './system-db-engines.js';
import { handleSystemDbRedisRoutes } from './system-db-redis.js';

export async function handleSystemDbRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSystemDbEnginesRoutes(ctx, req, res, url, method)) return true;
  if (await handleSystemDbRedisRoutes(ctx, req, res, url, method)) return true;
  return false;
}
