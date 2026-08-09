/**
 * Defense ops dispatcher (Wave P2).
 * ban → automation
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleDefenseBanRoutes } from './defense-ban.js';
import { handleDefenseAutomationRoutes } from './defense-automation.js';

export async function handleDefenseOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleDefenseBanRoutes(ctx, req, res, url, method)) return true;
  if (await handleDefenseAutomationRoutes(ctx, req, res, url, method)) return true;
  return false;
}
