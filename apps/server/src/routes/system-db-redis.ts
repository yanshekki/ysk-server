/**
 * System Redis + SQL dump dispatcher (Wave AA3).
 * redis → dump
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSystemRedisRoutes } from './system-redis.js';
import { handleSystemDbDumpRoutes } from './system-db-dump.js';

export async function handleSystemDbRedisRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSystemRedisRoutes(ctx, req, res, url, method)) return true;
  if (await handleSystemDbDumpRoutes(ctx, req, res, url, method)) return true;
  return false;
}
