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

  // GET /capabilities — auth + cap
  if (method === 'GET' && url.pathname === '/api/v1/host-browse/capabilities') {
    try {
      const user = ctx.auth.authenticate(getBearer(req));
      requireCap(ctx, user, 'network.browse');
      sendJson(res, 200, { ok: true, ...svc.capabilities() });
    } catch (e) {
      sendBrowseError(res, e);
    }
    return true;
  }

  // Content for iframe — contentToken auth only
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
      res.writeHead(content.status || 200, headers);
      res.end(content.body);
    } catch (e) {
      sendBrowseError(res, e);
    }
    return true;
  }

  // Form POST from iframe — contentToken auth
  const formMatch = url.pathname.match(
    /^\/api\/v1\/host-browse\/sessions\/([^/]+)\/form$/,
  );
  if (method === 'POST' && formMatch) {
    const sessionId = formMatch[1];
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
      const rawBody = await readBody(req);
      const ctHdr =
        (req.headers['content-type'] as string) ||
        'application/x-www-form-urlencoded';
      const result = await svc.submitByToken(
        sessionId,
        ct,
        target,
        rawBody,
        ctHdr,
      );
      // After form POST, redirect browser frame to content of final URL
      if (result.contentPath && !result.blocked) {
        res.writeHead(303, {
          Location: result.contentPath,
          'Cache-Control': 'no-store',
        });
        res.end();
      } else {
        sendJson(res, 200, { ...result, privacy: privacyBlock() });
      }
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
    if (method === 'POST' && url.pathname === '/api/v1/host-browse/sessions') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        mode?: string;
        engine?: string;
        startUrl?: string;
      };
      const mode = data.mode === 'intranet' ? 'intranet' : 'internet';
      const meta = svc.createSession(user.id, mode, data.engine);
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
        capabilities: svc.capabilities(),
        start,
      });
      return true;
    }

    // Library: home / bookmarks / history
    if (method === 'GET' && url.pathname === '/api/v1/host-browse/library') {
      sendJson(res, 200, { ok: true, library: svc.getLibraryFor(user.id) });
      return true;
    }
    if (method === 'PUT' && url.pathname === '/api/v1/host-browse/home') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as { homeUrl?: string };
      const library = svc.setHomeUrl(user.id, String(data.homeUrl || ''));
      sendJson(res, 200, { ok: true, library });
      return true;
    }
    if (method === 'POST' && url.pathname === '/api/v1/host-browse/bookmarks') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as { url?: string; title?: string };
      if (!data.url) {
        sendJson(res, 400, {
          ok: false,
          code: ErrorCodes.VALIDATION,
          message: 'url required',
        });
        return true;
      }
      const library = svc.toggleBookmark(user.id, {
        url: data.url,
        title: data.title,
      });
      sendJson(res, 200, { ok: true, library });
      return true;
    }
    if (
      method === 'DELETE' &&
      url.pathname.startsWith('/api/v1/host-browse/bookmarks/')
    ) {
      const id = url.pathname.split('/').pop() || '';
      const library = svc.deleteBookmark(user.id, id);
      sendJson(res, 200, { ok: true, library });
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
      sendJson(res, 200, {
        ok: true,
        ...meta,
        privacy: privacyBlock(),
      });
      return true;
    }

    if (method === 'DELETE' && rest === '') {
      await svc.deleteSession(user.id, sessionId);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === 'POST' && rest === '/clear-cookies') {
      const meta = await svc.clearCookies(user.id, sessionId);
      sendJson(res, 200, { ok: true, ...meta });
      return true;
    }

    if (method === 'POST' && rest === '/abort') {
      svc.abort(user.id, sessionId);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === 'POST' && rest === '/heartbeat') {
      svc.heartbeat(user.id, sessionId);
      sendJson(res, 200, { ok: true, at: new Date().toISOString() });
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

    if (method === 'POST' && rest === '/live') {
      // One-time WS ticket for browser-engine screencast
      const meta = svc.getSession(user.id, sessionId);
      if (meta.engine !== 'browser') {
        sendJson(res, 400, {
          ok: false,
          code: ErrorCodes.VALIDATION,
          message: 'live stream requires browser engine',
          details: { engine: meta.engine },
        });
        return true;
      }
      // Ensure browser context exists (navigateBrowser already preferred path)
      await svc.ensureBrowserSession(user.id, sessionId);
      const ticket = ctx.hostBrowseLiveTickets.issue({
        sessionId,
        userId: user.id,
        ttlMs: 60_000,
      });
      sendJson(res, 200, {
        ok: true,
        ticket: ticket.ticket,
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        wsPath: `/api/v1/host-browse/ws?ticket=${encodeURIComponent(ticket.ticket)}`,
      });
      return true;
    }

    if (method === 'GET' && rest === '/downloads') {
      const downloads = svc.listDownloads(user.id, sessionId);
      sendJson(res, 200, { ok: true, downloads });
      return true;
    }

    const dlMatch = rest.match(/^\/downloads\/([^/]+)$/);
    if (method === 'GET' && dlMatch) {
      const d = svc.getDownloadFile(user.id, sessionId, dlMatch[1]);
      const { createReadStream } = await import('node:fs');
      const { basename } = await import('node:path');
      const name = basename(d.filename || 'download');
      res.writeHead(200, {
        'Content-Type': d.mime || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      createReadStream(d.absPath!).pipe(res);
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
