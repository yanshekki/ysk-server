/**
 * Defense Center dispatcher (Wave O1).
 * protection → ops
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleDefenseProtectionRoutes } from './defense-protection.js';
import { handleDefenseOpsRoutes } from './defense-ops.js';

export async function handleDefenseCenterRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleDefenseProtectionRoutes(ctx, req, res, url, method)) return true;
  if (await handleDefenseOpsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
