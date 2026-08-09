/**
 * Host-mediated proxy browser API — thin handlers over HostBrowseService.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson } from '../http/util.js';
import { requireCap } from '../http/rbac-guard.js';

function sendBrowseError(res: ServerResponse, e: unknown): void {
  if (e instanceof YskError) {
    sendJson(res, e.httpStatus ?? 400, {
      ok: false,
      code: e.code,
      message: e.message,
      details: e.details,
    });
    return;
  }
  sendJson(res, 500, {
    ok: false,
    code: ErrorCodes.INTERNAL,
    message: e instanceof Error ? e.message : 'internal error',
  });
}

function privacyBlock() {
  return {
    clientHeadersForwarded: false,
    cookieJar: 'server-only' as const,
    egress: 'host' as const,
  };
}

export async function handleHostBrowseRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/host-browse')) return false;

  const svc = ctx.hostBrowse;

  // Content for iframe — contentToken auth only (no Bearer required)
  const contentMatch = url.pathname.match(
    /^\/api\/v1\/host-browse\/sessions\/([^/]+)\/content$/,
  );
  if (method === 'GET' && contentMatch) {
    const sessionId = contentMatch[1];
    const ct = url.searchParams.get('ct') || '';
    const target = url.searchParams.get('u') || '';
    try {
      if (!target) {
        sendJson(res, 400, {
          ok: false,
          code: ErrorCodes.VALIDATION,
          message: 'u query required',
        });
        return true;
      }
      const content = await svc.getContentByToken(sessionId, ct, target);
      const headers: Record<string, string | number> = {
        'Content-Type': content.contentType || 'application/octet-stream',
        'Content-Length': content.body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "sandbox allow-scripts allow-forms allow-modals allow-popups; frame-ancestors 'self'; default-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline' data: https: http:; script-src 'unsafe-inline' 'unsafe-eval' https: http:; font-src data: https: http:; connect-src 'none'; base-uri 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Ysk-Host-Browse': '1',
        'X-Ysk-Final-Url': content.finalUrl.slice(0, 500),
      };
      // Allow framing by same origin panel (override default DENY from securityHeaders)
      res.writeHead(content.status || 200, headers);
      res.end(content.body);
    } catch (e) {
      sendBrowseError(res, e);
    }
    return true;
  }

  // Remaining routes require auth + network.browse
  let user: ReturnType<AppContext['auth']['authenticate']>;
  try {
    user = ctx.auth.authenticate(getBearer(req));
    requireCap(ctx, user, 'network.browse');
  } catch (e) {
    sendBrowseError(res, e);
    return true;
  }

  try {
    // POST /sessions
    if (method === 'POST' && url.pathname === '/api/v1/host-browse/sessions') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        mode?: string;
        startUrl?: string;
      };
      const mode = data.mode === 'intranet' ? 'intranet' : 'internet';
      const meta = svc.createSession(user.id, mode);
      let start: unknown = null;
      if (data.startUrl) {
        start = await svc.navigate(user.id, meta.sessionId, {
          url: data.startUrl,
          action: 'goto',
        });
      }
      sendJson(res, 200, {
        ok: true,
        ...meta,
        privacy: privacyBlock(),
        start,
      });
      return true;
    }

    const sessionMatch = url.pathname.match(
      /^\/api\/v1\/host-browse\/sessions\/([^/]+)(.*)$/,
    );
    if (!sessionMatch) {
      sendJson(res, 404, {
        ok: false,
        code: ErrorCodes.NOT_FOUND,
        message: 'Not found',
      });
      return true;
    }
    const sessionId = sessionMatch[1];
    const rest = sessionMatch[2] || '';

    if (method === 'GET' && rest === '') {
      const meta = svc.getSession(user.id, sessionId);
      sendJson(res, 200, { ok: true, ...meta, privacy: privacyBlock() });
      return true;
    }

    if (method === 'DELETE' && rest === '') {
      svc.deleteSession(user.id, sessionId);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === 'POST' && rest === '/clear-cookies') {
      const meta = svc.clearCookies(user.id, sessionId);
      sendJson(res, 200, { ok: true, ...meta });
      return true;
    }

    if (method === 'POST' && rest === '/navigate') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        url?: string;
        action?: 'goto' | 'reload' | 'back' | 'forward';
      };
      const result = await svc.navigate(user.id, sessionId, data);
      sendJson(res, 200, { ...result, privacy: privacyBlock() });
      return true;
    }

    if (method === 'POST' && rest === '/submit') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        url?: string;
        method?: string;
        contentType?: string;
        body?: string;
      };
      if (!data.url) {
        sendJson(res, 400, {
          ok: false,
          code: ErrorCodes.VALIDATION,
          message: 'url required',
        });
        return true;
      }
      const result = await svc.submit(user.id, sessionId, {
        url: data.url,
        method: data.method,
        contentType: data.contentType,
        body: data.body,
      });
      sendJson(res, 200, { ...result, privacy: privacyBlock() });
      return true;
    }

    sendJson(res, 404, {
      ok: false,
      code: ErrorCodes.NOT_FOUND,
      message: 'Not found',
    });
    return true;
  } catch (e) {
    sendBrowseError(res, e);
    return true;
  }
}
