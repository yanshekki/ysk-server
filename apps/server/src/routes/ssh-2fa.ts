/**
 * SSH 2FA dispatcher (Wave W2).
 * host → vault (specific snippet paths before generic list)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSsh2faHostRoutes } from './ssh-2fa-host.js';
import { handleSsh2faVaultRoutes } from './ssh-2fa-vault.js';

export async function handleSsh2faRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSsh2faHostRoutes(ctx, req, res, url, method)) return true;
  if (await handleSsh2faVaultRoutes(ctx, req, res, url, method)) return true;
  return false;
}
