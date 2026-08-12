/**
 * Managed resource routes dispatcher (Wave S1).
 * Path-gated: auth + parse → crud → apply
 */
import { tl } from '@yanshekki/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { getBearer, sendJson } from '../http/util.js';
import { parseResourceCollection } from './resources-shared.js';
import { handleResourcesCrudRoutes } from './resources-crud.js';
import { handleResourcesApplyRoutes } from './resources-apply.js';

export { redactResourceSecrets } from './resources-shared.js';

export async function handleResourcesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/resources')) return false;

  const user = ctx.auth.authenticate(getBearer(req));
  const { key, id, action, prefix } = parseResourceCollection(url.pathname);
  if (!key || !prefix) {
    sendJson(res, 404, { ok: false, message: tl('notes.auto.n0966') });
    return true;
  }

  if (await handleResourcesCrudRoutes(ctx, req, res, url, method, user, key, id, action, prefix)) {
    return true;
  }
  if (await handleResourcesApplyRoutes(ctx, req, res, url, method, user, key, id, action, prefix)) {
    return true;
  }
  return false;
}
