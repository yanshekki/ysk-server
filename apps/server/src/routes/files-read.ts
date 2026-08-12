/**
 * Authenticated file read paths — list/read/download/stat (Wave T1).
 * Extracted from files.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import { listFavorites, type FileManager } from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import { sendJson } from '../http/util.js';

export type FilesAuthCtx = {
  rootKey: string;
  fm: FileManager;
};

export async function handleFilesReadRoutes(
  ctx: AppContext,
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  auth: FilesAuthCtx,
): Promise<boolean> {
  const { rootKey, fm } = auth;

  if (method === 'GET' && url.pathname === '/api/v1/files') {
    const path = url.searchParams.get('path') ?? '.';
    const sort = (url.searchParams.get('sort') as 'name' | 'size' | 'mtime') || 'name';
    const order = (url.searchParams.get('order') as 'asc' | 'desc') || 'asc';
    const q = url.searchParams.get('q') ?? undefined;
    const items = fm.list(path, { sort, order, q });
    const favs = new Set(listFavorites(ctx.db, rootKey).map((f) => f.path));
    const usage = fm.usage();
    sendJson(res, 200, {
      root: rootKey,
      path,
      items: items.map((i) => ({ ...i, favorite: favs.has(i.path) })),
      usage });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/files/read') {
    const path = url.searchParams.get('path') ?? '';
    sendJson(res, 200, fm.readText(path));
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/files/download') {
    const path = url.searchParams.get('path') ?? '';
    try {
      const file = fm.readBinary(path);
      res.writeHead(200, {
        'Content-Type': file.mime,
        'Content-Length': file.buffer.length,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
        'Access-Control-Allow-Origin': '*' });
      res.end(file.buffer);
    } catch (e) {
      sendJson(res, 404, {
        ok: false,
        message: e instanceof Error ? e.message : tl('notes.notFound') });
    }
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/files/stat') {
    const path = url.searchParams.get('path') ?? '';
    sendJson(res, 200, fm.stat(path));
    return true;
  }

  return false;
}
