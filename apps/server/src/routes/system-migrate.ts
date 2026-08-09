/**
 * System migrate dispatcher (Wave R2).
 * export → host
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSystemMigrateExportRoutes } from './system-migrate-export.js';
import { handleSystemMigrateHostRoutes } from './system-migrate-host.js';

export async function handleSystemMigrateRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSystemMigrateExportRoutes(ctx, req, res, url, method)) return true;
  if (await handleSystemMigrateHostRoutes(ctx, req, res, url, method)) return true;
  return false;
}
