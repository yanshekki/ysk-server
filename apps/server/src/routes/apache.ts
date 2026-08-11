/**
 * Apache sites + settings API.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listApacheSites,
  createApacheSite,
  updateApacheSite,
  deleteApacheSite,
  applyApacheSite,
  loadApacheSettings,
  saveApacheSettings,
  applyApacheSettings,
} from '@ysk/core';
import { ErrorCodes } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';

export async function handleApacheRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/hosting/apache')) return false;

  try {
    if (method === 'GET' && url.pathname === '/api/v1/hosting/apache/sites') {
      ctx.auth.authenticate(getBearer(req));
      sendJson(res, 200, { items: listApacheSites(ctx.dataDir) });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/v1/hosting/apache/sites') {
      const user = ctx.auth.authenticate(getBearer(req));
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        serverName?: string;
        kind?: string;
        upstream?: string;
        root?: string;
        ssl?: boolean;
      };
      const item = createApacheSite(ctx.dataDir, {
        serverName: data.serverName ?? '',
        kind:
          data.kind === 'static' || data.kind === 'php' ? data.kind : 'proxy',
        upstream: data.upstream,
        root: data.root,
        ssl: data.ssl,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'apache.site.create',
        resource: item.id,
        detail: { serverName: item.serverName, kind: item.kind },
        ok: true,
      });
      sendJson(res, 201, { item });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/v1/hosting/apache/settings') {
      ctx.auth.authenticate(getBearer(req));
      sendJson(res, 200, { settings: loadApacheSettings(ctx.dataDir) });
      return true;
    }

    if (method === 'PATCH' && url.pathname === '/api/v1/hosting/apache/settings') {
      const user = ctx.auth.authenticate(getBearer(req));
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as Record<string, unknown>;
      const settings = saveApacheSettings(ctx.dataDir, data as never);
      ctx.audit.append({
        actor: user.username,
        action: 'apache.settings.patch',
        detail: { keys: Object.keys(data) },
        ok: true,
      });
      sendJson(res, 200, { ok: true, settings });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/v1/hosting/apache/settings/apply') {
      const user = ctx.auth.authenticate(getBearer(req));
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as Record<string, unknown>;
      const result = await applyApacheSettings({
        dataDir: ctx.dataDir,
        host: ctx.host,
        patch: Object.keys(data).length ? (data as never) : undefined,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'apache.settings.apply',
        detail: { ok: result.ok, blocked: result.blocked },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ...result,
        apply_status: result.blocked ? 'blocked' : result.ok ? 'applied' : 'failed',
      });
      return true;
    }

    const siteMatch = url.pathname.match(
      /^\/api\/v1\/hosting\/apache\/sites\/([^/]+)(?:\/(apply|settings))?$/,
    );
    if (siteMatch) {
      const id = decodeURIComponent(siteMatch[1] ?? '');
      const action = siteMatch[2];

      if (method === 'PATCH' && !action) {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as Record<string, unknown>;
        const item = updateApacheSite(ctx.dataDir, id, data as never);
        sendJson(res, 200, { item });
        return true;
      }

      if (method === 'DELETE' && !action) {
        const user = ctx.auth.authenticate(getBearer(req));
        const ok = deleteApacheSite(ctx.dataDir, id);
        ctx.audit.append({
          actor: user.username,
          action: 'apache.site.delete',
          resource: id,
          detail: { ok },
          ok,
        });
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }

      if (method === 'POST' && action === 'apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const result = await applyApacheSite({
          dataDir: ctx.dataDir,
          host: ctx.host,
          id,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'apache.site.apply',
          resource: id,
          detail: { ok: result.ok, blocked: result.blocked },
          ok: result.ok,
        });
        sendOpsResult(res, {
          ...result,
          apply_status: result.blocked
            ? 'blocked'
            : result.ok
              ? 'applied'
              : 'failed',
        });
        return true;
      }

      if (method === 'PATCH' && action === 'settings') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as Record<string, unknown>;
        updateApacheSite(ctx.dataDir, id, data as never);
        const result = await applyApacheSite({
          dataDir: ctx.dataDir,
          host: ctx.host,
          id,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'apache.site.settings',
          resource: id,
          detail: { keys: Object.keys(data), ok: result.ok, blocked: result.blocked },
          ok: result.ok,
        });
        sendOpsResult(res, {
          ...result,
          apply_status: result.blocked
            ? 'blocked'
            : result.ok
              ? 'applied'
              : 'failed',
        });
        return true;
      }
    }

    sendJson(res, 404, {
      ok: false,
      code: ErrorCodes.NOT_FOUND,
      message: 'not found',
    });
    return true;
  } catch (e) {
    const err = e as { httpStatus?: number; code?: string; message?: string };
    sendJson(res, err.httpStatus ?? 500, {
      ok: false,
      code: err.code ?? ErrorCodes.INTERNAL,
      message: err.message ?? String(e),
    });
    return true;
  }
}
