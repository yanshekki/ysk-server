/**
 * SSH identity vault dispatcher (Wave S3).
 * ops → crud (action paths before generic :id)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleSshIdentitiesOpsRoutes } from './ssh-identities-ops.js';
import { handleSshIdentitiesCrudRoutes } from './ssh-identities-crud.js';

export async function handleSshIdentitiesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleSshIdentitiesOpsRoutes(ctx, req, res, url, method)) return true;
  if (await handleSshIdentitiesCrudRoutes(ctx, req, res, url, method)) return true;
  return false;
}
