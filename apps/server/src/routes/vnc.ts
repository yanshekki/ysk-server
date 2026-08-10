/**
 * VNC server + client API (PR-A: status + settings).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createVncService } from '@ysk/core';
import { ErrorCodes } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson } from '../http/util.js';
import { requireCap } from '../http/rbac-guard.js';

export async function handleVncRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/vnc')) return false;

  let user: ReturnType<AppContext['auth']['authenticate']>;
  try {
    user = ctx.auth.authenticate(getBearer(req));
    requireCap(ctx, user, 'network.vnc');
  } catch (e) {
    const err = e as { httpStatus?: number; code?: string; message?: string };
    sendJson(res, err.httpStatus ?? 403, {
      ok: false,
      code: err.code ?? ErrorCodes.FORBIDDEN,
      message: err.message ?? 'forbidden',
    });
    return true;
  }

  const vnc = createVncService(ctx.dataDir, ctx.host);

  try {
    if (method === 'GET' && url.pathname === '/api/v1/vnc/status') {
      const status = await vnc.status();
      sendJson(res, 200, { ok: true, ...status, accounts: [], clientProfiles: [] });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/v1/vnc/settings') {
      sendJson(res, 200, { ok: true, settings: vnc.loadSettings() });
      return true;
    }

    if (method === 'PATCH' && url.pathname === '/api/v1/vnc/settings') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as Record<string, unknown>;
      const settings = vnc.saveSettings({
        defaultDesktop:
          data.defaultDesktop === 'xfce' ||
          data.defaultDesktop === 'minimal' ||
          data.defaultDesktop === 'none'
            ? data.defaultDesktop
            : undefined,
        defaultGeometry:
          typeof data.defaultGeometry === 'string' ? data.defaultGeometry : undefined,
        defaultDepth:
          typeof data.defaultDepth === 'number' ? data.defaultDepth : undefined,
        defaultRfbBind:
          data.defaultRfbBind === 'localhost' || data.defaultRfbBind === 'all'
            ? data.defaultRfbBind
            : undefined,
        defaultAutostart:
          typeof data.defaultAutostart === 'boolean' ? data.defaultAutostart : undefined,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'vnc.settings.patch',
        detail: { keys: Object.keys(data) },
        ok: true,
      });
      sendJson(res, 200, { ok: true, settings });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/v1/vnc/accounts') {
      sendJson(res, 200, { ok: true, items: [] });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/v1/vnc/client/profiles') {
      sendJson(res, 200, { ok: true, items: [] });
      return true;
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
