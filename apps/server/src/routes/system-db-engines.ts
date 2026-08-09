/**
 * System DB engines dispatcher (Wave U3).
 * console → sql
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSystemDbConsoleRoutes } from './system-db-console.js';
import { handleSystemDbSqlRoutes } from './system-db-sql.js';

export async function handleSystemDbEnginesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSystemDbConsoleRoutes(ctx, req, res, url, method)) return true;
  if (await handleSystemDbSqlRoutes(ctx, req, res, url, method)) return true;
  return false;
}
