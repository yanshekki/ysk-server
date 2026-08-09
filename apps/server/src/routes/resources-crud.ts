/**
 * Managed resource CRUD dispatcher (Wave U1).
 * read → write
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CollectionKey } from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { handleResourcesReadRoutes } from './resources-read.js';
import { handleResourcesWriteRoutes } from './resources-write.js';

export async function handleResourcesCrudRoutes(
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
  if (await handleResourcesReadRoutes(ctx, req, res, url, method, user, key, id, action, prefix)) {
    return true;
  }
  if (await handleResourcesWriteRoutes(ctx, req, res, url, method, user, key, id, action, prefix)) {
    return true;
  }
  return false;
}
