/**
 * File manager authenticated dispatcher (Wave T1).
 * auth+root → read → write → meta
 */
import { tl } from '@ysk/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FileManager } from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { getBearer, sendJson } from '../http/util.js';
import { resolveRoot } from './files-shared.js';
import { handleFilesReadRoutes } from './files-read.js';
import { handleFilesWriteRoutes } from './files-write.js';
import { handleFilesMetaSection } from './files-meta.js';

export async function handleFilesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // WebDAV + public share download → routes/files-public.ts (Wave E1)

  if (!url.pathname.startsWith('/api/v1/files')) return false;

  // Authenticated routes
  const user = ctx.auth.authenticate(getBearer(req));
  const rootParam = url.searchParams.get('root') ?? 'public';
  let root: string;
  let rootKey: string;
  let owner: { linuxUser: string; linuxGroup: string; homeDir: string } | undefined;
  try {
    ({ root, rootKey, owner } = resolveRoot(ctx, rootParam, { user }));
  } catch (e) {
    sendJson(res, 400, {
      ok: false,
      message: e instanceof Error ? e.message : tl('notes.auto.n1008') });
    return true;
  }
  const fm = new FileManager(root);

  if (await handleFilesReadRoutes(ctx, req, res, url, method, { rootKey, fm })) {
    return true;
  }
  if (await handleFilesWriteRoutes(ctx, req, res, url, method, { user, rootKey, owner, fm })) {
    return true;
  }
  // trash/shares/favorites/versions/webdav settings → files-meta (Wave E2)
  if (await handleFilesMetaSection(ctx, req, res, url, method, { user, rootKey, fm })) {
    return true;
  }

  return false;
}
