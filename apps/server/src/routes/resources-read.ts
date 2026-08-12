/**
 * Managed resource list/get (Wave U1).
 * Extracted from resources-crud.ts. Behaviour preserved.
 */
import { tl } from '@yanshekki/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listResources,
  getResource,
  type CollectionKey,
} from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import { sendJson } from '../http/util.js';
import { redactResourceSecrets } from './resources-shared.js';

export async function handleResourcesReadRoutes(
  ctx: AppContext,
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  _user: { username: string },
  key: CollectionKey,
  id: string | null,
  action: string | null,
  _prefix: string,
): Promise<boolean> {
  // LIST
  if (method === 'GET' && !id) {
    // SSL: never expose raw multi-row junk — use disk+store view
    if (key === 'certificates') {
      const { listCertificatesView, dedupeCertificatesInStore } = await import('@yanshekki/core');
      dedupeCertificatesInStore(ctx.db);
      sendJson(res, 200, { items: listCertificatesView(ctx.db, ctx.dataDir) });
      return true;
    }
    let items = listResources(ctx.db, key) as Array<Record<string, unknown>>;
    const zoneId = url.searchParams.get('zoneId');
    const databaseId = url.searchParams.get('databaseId');
    const engine = url.searchParams.get('engine');
    if (zoneId) items = items.filter((r) => r.zoneId === zoneId);
    if (databaseId) items = items.filter((r) => r.databaseId === databaseId);
    if (engine) {
      items = items.filter((r) => String(r.engine ?? 'mysql') === engine);
    }
    const { listWithQuery } = await import('../http/list-response.js');
    const { items: filtered, meta } = listWithQuery(url, items, {
      text: (r) =>
        Object.values(r)
          .filter((v) => typeof v === 'string' || typeof v === 'number')
          .map(String),
    });
    sendJson(res, 200, {
      items: filtered.map((r) => redactResourceSecrets(key, r as Record<string, unknown>)),
      meta,
    });
    return true;
  }

  // GET one
  if (method === 'GET' && id && !action) {
    const row = getResource(ctx.db, key, id);
    if (!row) {
      sendJson(res, 404, { ok: false, message: tl('notes.auto.n0004') });
      return true;
    }
    sendJson(res, 200, {
      item: redactResourceSecrets(key, row as Record<string, unknown>),
    });
    return true;
  }

  return false;
}
