/**
 * Audit log list — extracted from misc residual.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { requireUser } from '../http/handler.js';
import { listWithQuery } from '../http/list-response.js';
import { sendJson } from '../http/util.js';

export async function handleAuditRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/audit') {
    requireUser(ctx, req);
    const limitRaw = Number(url.searchParams.get('limit') || 200);
    const fetchN = Math.min(500, Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200);
    type AuditRow = {
      actor?: string;
      action?: string;
      resource?: string;
      detail?: unknown;
    };
    const all = ctx.audit.listRecent(fetchN) as unknown as AuditRow[];
    const { items, meta } = listWithQuery(url, all, {
      text: (e: AuditRow) => [
        String(e.actor ?? ''),
        String(e.action ?? ''),
        String(e.resource ?? ''),
        JSON.stringify(e.detail ?? ''),
      ],
    });
    sendJson(res, 200, { items, meta });
    return true;
  }
  return false;
}
