/**
 * Global panel search — extracted from misc for domain ownership.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { requireUser } from '../http/handler.js';
import { sendJson } from '../http/util.js';

export async function handleSearchRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/search') {
    requireUser(ctx, req);
    const q = url.searchParams.get('q') ?? '';
    const { globalSearch } = await import('@yanshekki/core');
    sendJson(res, 200, { items: globalSearch(ctx.db, q) });
    return true;
  }
  return false;
}
