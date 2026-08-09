/**
 * HostBrowseService — host-egress HTTP fetch with privacy + SSRF.
 */

import { ErrorCodes, YskError } from '@ysk/shared';
import { buildOutboundHeaders, filterResponseMetaHeaders } from './headers.js';
import {
  extractTitle,
  rewriteCss,
  rewriteHtml,
} from './rewrite-html.js';
import { assertHostBrowseTarget } from './ssrf.js';
import {
  HostBrowseSessionStore,
  type HostBrowseSession,
} from './session-store.js';
import type {
  HostBrowseContentResult,
  HostBrowseFetchResult,
  HostBrowseMode,
  HostBrowseNavigateAction,
  HostBrowsePolicy,
  HostBrowseSessionMeta,
} from './types.js';
import { HOST_BROWSE_DEFAULT_UA } from './types.js';

export type HostBrowseAuditFn = (event: {
  action: string;
  userId: string;
  ok: boolean;
  detail: Record<string, unknown>;
}) => void;

export class HostBrowseService {
  readonly store: HostBrowseSessionStore;

  constructor(
    private readonly policy: HostBrowsePolicy = {},
    private readonly audit?: HostBrowseAuditFn,
  ) {
    this.store = new HostBrowseSessionStore(policy);
  }

  createSession(userId: string, mode: HostBrowseMode): HostBrowseSessionMeta {
    if (mode !== 'internet' && mode !== 'intranet') {
      throw new YskError(ErrorCodes.VALIDATION, 'Invalid browse mode', {
        httpStatus: 400,
        details: { field: 'mode' },
      });
    }
    const s = this.store.create(userId, mode);
    this.audit?.({
      action: 'host_browse.session_create',
      userId,
      ok: true,
      detail: { sessionId: s.sessionId, mode },
    });
    return this.store.toMeta(s);
  }

  getSession(userId: string, sessionId: string): HostBrowseSessionMeta {
    const s = this.requireSession(userId, sessionId);
    return this.store.toMeta(s);
  }

  deleteSession(userId: string, sessionId: string): void {
    const ok = this.store.delete(sessionId, userId);
    if (!ok) {
      throw new YskError(ErrorCodes.HOST_BROWSE_SESSION, 'Session not found', {
        httpStatus: 404,
      });
    }
    this.audit?.({
      action: 'host_browse.session_delete',
      userId,
      ok: true,
      detail: { sessionId },
    });
  }

  clearCookies(userId: string, sessionId: string): HostBrowseSessionMeta {
    const s = this.requireSession(userId, sessionId);
    s.jar.clear();
    return this.store.toMeta(s);
  }

  contentPath(session: HostBrowseSession, absoluteUrl: string): string {
    const u = encodeURIComponent(absoluteUrl);
    return `/api/v1/host-browse/sessions/${session.sessionId}/content?u=${u}&ct=${encodeURIComponent(session.contentToken)}`;
  }

  async navigate(
    userId: string,
    sessionId: string,
    input: {
      url?: string;
      action?: HostBrowseNavigateAction;
    },
  ): Promise<HostBrowseFetchResult> {
    const s = this.requireSession(userId, sessionId);
    if (!this.store.checkRate(userId)) {
      throw new YskError(ErrorCodes.RATE_LIMITED, 'Host browse rate limit', {
        httpStatus: 429,
      });
    }

    const action = input.action ?? 'goto';
    let targetUrl: string | null = null;

    if (action === 'back') {
      if (s.historyIndex <= 0) {
        throw new YskError(ErrorCodes.VALIDATION, 'No back history', {
          httpStatus: 400,
        });
      }
      s.historyIndex -= 1;
      targetUrl = s.history[s.historyIndex]?.url ?? null;
    } else if (action === 'forward') {
      if (s.historyIndex >= s.history.length - 1) {
        throw new YskError(ErrorCodes.VALIDATION, 'No forward history', {
          httpStatus: 400,
        });
      }
      s.historyIndex += 1;
      targetUrl = s.history[s.historyIndex]?.url ?? null;
    } else if (action === 'reload') {
      targetUrl = s.currentUrl;
      if (!targetUrl) {
        throw new YskError(ErrorCodes.VALIDATION, 'Nothing to reload', {
          httpStatus: 400,
        });
      }
    } else {
      targetUrl = input.url ?? null;
      if (!targetUrl) {
        throw new YskError(ErrorCodes.VALIDATION, 'URL required', {
          httpStatus: 400,
          details: { field: 'url' },
        });
      }
    }

    const result = await this.fetchThroughSession(s, targetUrl, {
      method: 'GET',
      pushHistory: action === 'goto' || action === 'reload',
      replaceHistoryUrl: action === 'back' || action === 'forward',
    });

    this.audit?.({
      action: 'host_browse.navigate',
      userId,
      ok: result.ok && !result.blocked,
      detail: {
        sessionId,
        mode: s.mode,
        action,
        host: safeHost(result.finalUrl),
        status: result.status,
        blocked: result.blocked,
        blockReason: result.blockReason,
        latencyMs: result.latencyMs,
      },
    });

    return result;
  }

  async submit(
    userId: string,
    sessionId: string,
    input: {
      url: string;
      method?: string;
      contentType?: string;
      body?: string;
    },
  ): Promise<HostBrowseFetchResult> {
    const s = this.requireSession(userId, sessionId);
    if (!this.store.checkRate(userId)) {
      throw new YskError(ErrorCodes.RATE_LIMITED, 'Host browse rate limit', {
        httpStatus: 429,
      });
    }
    const method = (input.method ?? 'POST').toUpperCase();
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
      throw new YskError(ErrorCodes.VALIDATION, 'Invalid submit method', {
        httpStatus: 400,
        details: { field: 'method' },
      });
    }
    const maxReq = this.policy.maxRequestBodyBytes ?? 1 * 1024 * 1024;
    const body = input.body ?? '';
    if (Buffer.byteLength(body, 'utf8') > maxReq) {
      throw new YskError(ErrorCodes.VALIDATION, 'Request body too large', {
        httpStatus: 400,
      });
    }

    const result = await this.fetchThroughSession(s, input.url, {
      method,
      body,
      contentType: input.contentType ?? 'application/x-www-form-urlencoded',
      pushHistory: true,
    });

    this.audit?.({
      action: 'host_browse.submit',
      userId,
      ok: result.ok && !result.blocked,
      detail: {
        sessionId,
        mode: s.mode,
        method,
        host: safeHost(result.finalUrl),
        status: result.status,
        blocked: result.blocked,
      },
    });

    return result;
  }

  /**
   * Return body for iframe — auth is sessionId + contentToken only
   * (iframe cannot send Bearer; token is high-entropy and session-scoped).
   */
  async getContentByToken(
    sessionId: string,
    contentToken: string,
    rawUrl: string,
  ): Promise<HostBrowseContentResult> {
    this.store.purgeExpired();
    const s = this.store.getById(sessionId);
    if (!s || !this.store.verifyContentToken(s, contentToken)) {
      throw new YskError(ErrorCodes.UNAUTHORIZED, 'Invalid content token', {
        httpStatus: 401,
      });
    }
    s.lastAccessAt = Date.now();

    // Serve cache if same URL just navigated
    if (s.lastContent && s.lastContent.url === rawUrl) {
      return {
        status: s.lastContent.status,
        finalUrl: s.lastContent.url,
        contentType: s.lastContent.contentType,
        body: s.lastContent.body,
        rewritten: s.lastContent.rewritten,
        warnings: s.lastContent.warnings,
        headers: {
          'content-type': s.lastContent.contentType,
          'x-ysk-host-browse': '1',
        },
      };
    }

    const result = await this.fetchThroughSession(s, rawUrl, {
      method: 'GET',
      pushHistory: false,
    });

    if (!s.lastContent) {
      throw new YskError(ErrorCodes.HOST_BROWSE_UPSTREAM, 'No content', {
        httpStatus: 502,
      });
    }

    return {
      status: s.lastContent.status,
      finalUrl: result.finalUrl,
      contentType: s.lastContent.contentType,
      body: s.lastContent.body,
      rewritten: s.lastContent.rewritten,
      warnings: s.lastContent.warnings,
      headers: {
        'content-type': s.lastContent.contentType,
        'x-ysk-host-browse': '1',
      },
    };
  }

  /** @deprecated prefer getContentByToken for iframe; kept for tests with user binding */
  async getContent(
    userId: string,
    sessionId: string,
    contentToken: string,
    rawUrl: string,
  ): Promise<HostBrowseContentResult> {
    this.requireSession(userId, sessionId);
    return this.getContentByToken(sessionId, contentToken, rawUrl);
  }

  private requireSession(userId: string, sessionId: string): HostBrowseSession {
    const s = this.store.get(sessionId, userId);
    if (!s) {
      throw new YskError(ErrorCodes.HOST_BROWSE_SESSION, 'Session not found', {
        httpStatus: 404,
      });
    }
    return s;
  }

  private async fetchThroughSession(
    s: HostBrowseSession,
    rawUrl: string,
    opts: {
      method: string;
      body?: string;
      contentType?: string;
      pushHistory: boolean;
      replaceHistoryUrl?: boolean;
    },
  ): Promise<HostBrowseFetchResult> {
    const started = Date.now();
    const ssrfOpts = {
      mode: s.mode,
      allowLoopback: this.policy.allowLoopback,
      extraPorts: this.policy.extraPorts,
    };

    let current: URL;
    try {
      current = await assertHostBrowseTarget(rawUrl, ssrfOpts);
    } catch (e) {
      if (e instanceof YskError && e.code === ErrorCodes.HOST_BROWSE_SSRF) {
        return {
          ok: false,
          status: 0,
          finalUrl: rawUrl,
          contentType: null,
          bytes: 0,
          warnings: [],
          contentPath: '',
          latencyMs: Date.now() - started,
          rewritten: false,
          blocked: true,
          blockReason: String(
            (e.details as { reason?: string } | undefined)?.reason ?? 'ssrf',
          ),
        };
      }
      throw e;
    }

    const maxRedirects = this.policy.maxRedirects ?? 5;
    const timeoutMs = this.policy.timeoutMs ?? 30_000;
    const maxBody = this.policy.maxBodyBytes ?? 8 * 1024 * 1024;
    const warnings: string[] = [];
    let method = opts.method;
    let body = opts.body;
    let contentType = opts.contentType;
    let referer = s.currentUrl;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const cookie = s.jar.cookieHeaderFor(current);
      const headers = buildOutboundHeaders({
        userAgent: s.userAgent || HOST_BROWSE_DEFAULT_UA,
        acceptLanguage: this.policy.acceptLanguage,
        cookie: cookie || undefined,
        contentType: body != null ? contentType : undefined,
        referer,
      });

      let res: Response;
      try {
        res = await fetch(current.href, {
          method,
          headers,
          body: body != null && method !== 'GET' && method !== 'HEAD' ? body : undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new YskError(ErrorCodes.HOST_BROWSE_UPSTREAM, msg, {
          httpStatus: 502,
          details: { url: current.href.slice(0, 300) },
        });
      }

      // Absorb cookies for this hop
      s.jar.absorbFromResponseHeaders(res.headers, current);

      // Redirects
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          warnings.push('bad_redirect');
          break;
        }
        try {
          next = await assertHostBrowseTarget(next.href, ssrfOpts);
        } catch (e) {
          if (e instanceof YskError && e.code === ErrorCodes.HOST_BROWSE_SSRF) {
            return {
              ok: false,
              status: res.status,
              finalUrl: current.href,
              contentType: null,
              bytes: 0,
              warnings,
              contentPath: '',
              latencyMs: Date.now() - started,
              rewritten: false,
              blocked: true,
              blockReason: 'redirect_ssrf',
            };
          }
          throw e;
        }
        referer = current.href;
        current = next;
        // POST → GET on 301/302/303
        if (res.status === 303 || res.status === 302 || res.status === 301) {
          method = 'GET';
          body = undefined;
          contentType = undefined;
        }
        continue;
      }

      // Read body with size limit
      const ab = await res.arrayBuffer();
      let buf = Buffer.from(ab);
      if (buf.length > maxBody) {
        buf = buf.subarray(0, maxBody);
        warnings.push('body_truncated');
      }

      let contentTypeHdr =
        res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ||
        'application/octet-stream';
      let rewritten = false;
      let title: string | undefined;

      const isHtml =
        contentTypeHdr.includes('html') ||
        contentTypeHdr === 'text/html' ||
        contentTypeHdr === 'application/xhtml+xml';
      const isCss = contentTypeHdr.includes('text/css');

      if (isHtml) {
        let html = buf.toString('utf8');
        title = extractTitle(html);
        const { html: out, warnings: rw } = rewriteHtml(html, {
          pageUrl: current.href,
          proxyUrl: (abs) => this.contentPath(s, abs),
        });
        html = out;
        warnings.push(...rw);
        buf = Buffer.from(html, 'utf8');
        contentTypeHdr = 'text/html; charset=utf-8';
        rewritten = true;
      } else if (isCss) {
        const css = rewriteCss(buf.toString('utf8'), {
          pageUrl: current.href,
          proxyUrl: (abs) => this.contentPath(s, abs),
        });
        buf = Buffer.from(css, 'utf8');
        contentTypeHdr = 'text/css; charset=utf-8';
        rewritten = true;
      }

      s.lastContent = {
        url: current.href,
        status: res.status,
        contentType: contentTypeHdr,
        body: buf,
        rewritten,
        warnings: [...warnings],
      };

      if (opts.pushHistory) {
        this.store.pushHistory(s, current.href, title);
      } else if (opts.replaceHistoryUrl) {
        s.currentUrl = current.href;
        if (s.history[s.historyIndex]) {
          s.history[s.historyIndex] = {
            ...s.history[s.historyIndex],
            url: current.href,
            title: title ?? s.history[s.historyIndex].title,
          };
        }
      } else {
        s.currentUrl = current.href;
      }

      void filterResponseMetaHeaders(res.headers);

      return {
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        finalUrl: current.href,
        contentType: contentTypeHdr,
        bytes: buf.length,
        title,
        warnings,
        contentPath: this.contentPath(s, current.href),
        latencyMs: Date.now() - started,
        rewritten,
      };
    }

    throw new YskError(ErrorCodes.HOST_BROWSE_UPSTREAM, 'Too many redirects', {
      httpStatus: 502,
    });
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 80);
  }
}
