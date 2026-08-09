/**
 * Backups core dispatcher (Wave T2).
 * list → run
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleBackupsListRoutes } from './backups-list.js';
import { handleBackupsRunRoutes } from './backups-run.js';

export async function handleBackupsCoreRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleBackupsListRoutes(ctx, req, res, url, method)) return true;
  if (await handleBackupsRunRoutes(ctx, req, res, url, method)) return true;
  return false;
}
