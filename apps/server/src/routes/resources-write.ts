/**
 * Managed resource write dispatcher (Wave Z3).
 * create → mutate
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CollectionKey } from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import { handleResourcesCreateRoutes } from './resources-create.js';
import { handleResourcesMutateRoutes } from './resources-mutate.js';

export async function handleResourcesWriteRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  user: { username: string },
  key: CollectionKey,
  id: string | null,
  action: string | null,
  prefix: string,
): Promise<boolean> {
  if (await handleResourcesCreateRoutes(ctx, req, res, url, method, user, key, id, action, prefix)) {
    return true;
  }
  if (await handleResourcesMutateRoutes(ctx, req, res, url, method, user, key, id, action, prefix)) {
    return true;
  }
  return false;
}
