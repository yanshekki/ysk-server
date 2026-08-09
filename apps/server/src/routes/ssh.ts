/**
 * SSH routes dispatcher (Wave J3).
 * identities → sftp → 2fa
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSshIdentitiesRoutes } from './ssh-identities.js';
import { handleSshSftpRoutes } from './ssh-sftp.js';
import { handleSsh2faRoutes } from './ssh-2fa.js';

export async function handleSshRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSshIdentitiesRoutes(ctx, req, res, url, method)) return true;
  if (await handleSshSftpRoutes(ctx, req, res, url, method)) return true;
  if (await handleSsh2faRoutes(ctx, req, res, url, method)) return true;
  return false;
}
