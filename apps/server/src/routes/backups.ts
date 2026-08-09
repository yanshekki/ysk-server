/**
 * Backups routes dispatcher (Wave K2).
 * core → restic → settings
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleBackupsCoreRoutes } from './backups-core.js';
import { handleBackupsResticRoutes } from './backups-restic.js';
import { handleBackupsSettingsRoutes } from './backups-settings.js';

export async function handleBackupsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleBackupsCoreRoutes(ctx, req, res, url, method)) return true;
  if (await handleBackupsResticRoutes(ctx, req, res, url, method)) return true;
  if (await handleBackupsSettingsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
