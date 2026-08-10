/**
 * HostBrowseService — proxy (HTTP rewrite) + browser (Chromium) engines.
 */

import { ErrorCodes, YskError } from '@ysk/shared';
import { BrowserEngine } from './browser-engine.js';
import { probeChrome } from './chrome-probe.js';
import { buildOutboundHeaders, filterResponseMetaHeaders } from './headers.js';
import { extractTitle, rewriteCss, rewriteHtml } from './rewrite-html.js';
import { assertHostBrowseTarget } from './ssrf.js';
import {
  HostBrowseSessionStore,
  type HostBrowseSession,
} from './session-store.js';
import type {
  HostBrowseCapabilities,
  HostBrowseContentResult,
  HostBrowseEngine,
  HostBrowseFetchResult,
  HostBrowseMode,
  HostBrowseNavigateAction,
  HostBrowsePanelConfig,
  HostBrowsePolicy,
  HostBrowseSessionMeta,
} from './types.js';
import { HOST_BROWSE_DEFAULT_UA, mergeHostBrowsePolicy } from './types.js';
import { clearChromeProbeCache } from './chrome-probe.js';
import { evaluateNavigateSafety } from './danger.js';
import {
  emptyLibrary,
  pushHistory as libPushHistory,
  removeBookmark,
  saveSnapshot,
  setHome,
  upsertBookmark,
  type BrowseUserLibrary,
} from './bookmarks.js';
import {
  createEphemeralBrowseUser,
  destroyEphemeralBrowseUser,
} from './ephemeral-user.js';
import type { HostExecutor } from '../host/executor.js';

export type HostBrowseAuditFn = (event: {
  action: string;
  userId: string;
  ok: boolean;
  detail: Record<string, unknown>;
}) => void;

export class HostBrowseService {
  readonly store: HostBrowseSessionStore;
  readonly browser: BrowserEngine;
  private readonly basePolicy: HostBrowsePolicy;
  private readonly getPanelConfig?: () => HostBrowsePanelConfig | undefined;
  private readonly getHost?: () => HostExecutor;
  private readonly getDataDir?: () => string;
  private readonly getLibrary?: (userId: string) => BrowseUserLibrary;
  private readonly setLibrary?: (userId: string, lib: BrowseUserLibrary) => void;

  constructor(
    policy: HostBrowsePolicy = {},
    audit?: HostBrowseAuditFn,
    getPanelConfig?: () => HostBrowsePanelConfig | undefined,
    deps?: {
      getHost?: () => HostExecutor;
      getDataDir?: () => string;
      getLibrary?: (userId: string) => BrowseUserLibrary;
      setLibrary?: (userId: string, lib: BrowseUserLibrary) => void;
    },
  ) {
    this.basePolicy = policy;
    this.audit = audit;
    this.getPanelConfig = getPanelConfig;
    this.getHost = deps?.getHost;
    this.getDataDir = deps?.getDataDir;
    this.getLibrary = deps?.getLibrary;
    this.setLibrary = deps?.setLibrary;
    const getPol = () => this.effectivePolicy();
    this.store = new HostBrowseSessionStore(policy);
    this.browser = new BrowserEngine(getPol);
  }

  private audit?: HostBrowseAuditFn;

  private libOf(userId: string): BrowseUserLibrary {
    return this.getLibrary?.(userId) ?? emptyLibrary();
  }

  private saveLib(userId: string, lib: BrowseUserLibrary): void {
    this.setLibrary?.(userId, lib);
  }

  getLibraryFor(userId: string): BrowseUserLibrary {
    return this.libOf(userId);
  }

  listDownloads(userId: string, sessionId: string) {
    this.requireSession(userId, sessionId);
    return this.browser.listDownloads(sessionId);
  }

  getDownloadFile(userId: string, sessionId: string, downloadId: string) {
    this.requireSession(userId, sessionId);
    const d = this.browser.getDownload(sessionId, downloadId);
    if (!d || d.userId !== userId) {
      throw new YskError(ErrorCodes.NOT_FOUND, 'Download not found', {
        httpStatus: 404,
      });
    }
    if (d.status !== 'completed' || !d.absPath) {
      throw new YskError(ErrorCodes.VALIDATION, 'Download not ready', {
        httpStatus: 400,
        details: { status: d.status, reason: d.reason },
      });
    }
    return d;
  }

  setHomeUrl(userId: string, homeUrl: string): BrowseUserLibrary {
    const lib = setHome(this.libOf(userId), homeUrl);
    this.saveLib(userId, lib);
    return lib;
  }

  toggleBookmark(
    userId: string,
    input: { url: string; title?: string },
  ): BrowseUserLibrary {
    const lib = upsertBookmark(this.libOf(userId), input);
    this.saveLib(userId, lib);
    return lib;
  }

  deleteBookmark(userId: string, id: string): BrowseUserLibrary {
    const lib = removeBookmark(this.libOf(userId), id);
    this.saveLib(userId, lib);
    return lib;
  }

  heartbeat(userId: string, sessionId: string): void {
    const s = this.requireSession(userId, sessionId);
    s.lastHeartbeatAt = Date.now();
  }

  /** Kill browser + ephemeral user if heartbeat stale (call from timer). */
  async reapStaleSessions(maxIdleMs = 45_000): Promise<number> {
    const now = Date.now();
    let n = 0;
    for (const s of this.store.listAll()) {
      if (s.engine !== 'browser') continue;
      const last = s.lastHeartbeatAt ?? s.lastAccessAt;
      if (now - last > maxIdleMs) {
        await this.teardownBrowserSession(s.userId, s.sessionId);
        n += 1;
      }
    }
    return n;
  }

  /** Persist multi-tab URL snapshot for resume-on-return. */
  snapshotSession(userId: string, sessionId: string): void {
    const s = this.store.get(sessionId, userId);
    if (!s) return;
    const listed = this.browser.listTabs(sessionId);
    const tabs =
      listed.length > 0
        ? listed
            .map((t) => ({
              url: t.url,
              title: t.title || undefined,
            }))
            .filter((t) => t.url && t.url !== 'about:blank')
        : s.currentUrl
          ? [{ url: s.currentUrl }]
          : [];
    if (!tabs.length) return;
    const activeIndex = Math.max(
      0,
      listed.findIndex((t) => t.active),
    );
    const lib = saveSnapshot(this.libOf(userId), {
      tabs,
      activeIndex: activeIndex >= 0 ? activeIndex : 0,
      mode: s.mode,
      engine: s.engine,
      updatedAt: new Date().toISOString(),
    });
    this.saveLib(userId, lib);
  }

  clearLastSnapshot(userId: string): BrowseUserLibrary {
    const lib = { ...this.libOf(userId) };
    delete lib.lastSnapshot;
    this.saveLib(userId, lib);
    return lib;
  }

  async teardownBrowserSession(userId: string, sessionId: string): Promise<void> {
    const s = this.store.getById(sessionId);
    if (s && s.userId === userId) {
      this.snapshotSession(userId, sessionId);
    }
    await this.browser.closeSession(sessionId);
    if (s?.ephemeralUsername) {
      const host = this.getHost?.();
      if (host) {
        await destroyEphemeralBrowseUser({
          host,
          username: s.ephemeralUsername,
          homeDir: s.ephemeralHomeDir,
        });
      }
    }
    this.store.delete(sessionId, userId);
  }

  /** Live policy: panel settings overlay env/base. */
  effectivePolicy(): HostBrowsePolicy {
    return mergeHostBrowsePolicy(this.basePolicy, this.getPanelConfig?.() ?? null);
  }

  /** After panel settings change — drop Chrome process so path/sandbox re-apply. */
  async applyConfigChanged(): Promise<void> {
    clearChromeProbeCache();
    await this.browser.invalidateBrowser();
  }

  capabilities(): HostBrowseCapabilities {
    const pol = this.effectivePolicy();
    // Prefer explicit path from settings when probing
    if (pol.chromePath) {
      clearChromeProbeCache();
    }
    const p = probeChrome(true);
    const available = Boolean(pol.chromePath || p.available);
    // If chromePath set, verify executable later at launch; report available=true when path set
    const pathSet = Boolean(pol.chromePath);
    const engines: HostBrowseEngine[] = available || pathSet
      ? ['proxy', 'browser']
      : ['proxy'];
    const defEnv = pol.defaultEngine ?? 'auto';
    let defaultEngine: HostBrowseEngine = 'proxy';
    if (defEnv === 'browser' && (available || pathSet)) defaultEngine = 'browser';
    else if (defEnv === 'auto' && (available || pathSet)) defaultEngine = 'browser';
    else if (defEnv === 'proxy') defaultEngine = 'proxy';
    return {
      chromeAvailable: available || pathSet,
      chromePath: pol.chromePath || p.path,
      engines,
      defaultEngine,
      reason: available || pathSet ? undefined : p.reason,
      panel: this.getPanelConfig?.() ?? {},
      effective: {
        engine: defEnv === 'auto' || defEnv === 'proxy' || defEnv === 'browser' ? defEnv : 'auto',
        chromePath: pol.chromePath || p.path || '',
        allowLoopback: Boolean(pol.allowLoopback),
        noSandbox: Boolean(pol.noSandbox),
      },
      media: {
        video: 'screencast_jpeg',
        audio: 'not_bridged',
        chromeAudioMuted: true,
        policy: 'visual_only',
      },
    };
  }

  resolveEngine(requested?: string | null): HostBrowseEngine {
    const caps = this.capabilities();
    if (requested === 'browser') {
      if (!caps.chromeAvailable) {
        throw new YskError(
          ErrorCodes.HOST_BROWSE_NEED_CHROME,
          caps.reason || 'Chrome required for browser engine',
          { httpStatus: 503, details: { requiresChrome: true } },
        );
      }
      return 'browser';
    }
    if (requested === 'proxy') return 'proxy';
    return caps.defaultEngine;
  }

  createSession(
    userId: string,
    mode: HostBrowseMode,
    engine?: string | null,
  ): HostBrowseSessionMeta {
    if (mode !== 'internet' && mode !== 'intranet') {
      throw new YskError(ErrorCodes.VALIDATION, 'Invalid browse mode', {
        httpStatus: 400,
        details: { field: 'mode' },
      });
    }
    const eng = this.resolveEngine(engine);
    // purge expired browser contexts
    for (const id of this.store.purgeExpired()) {
      void this.browser.closeSession(id);
    }
    const s = this.store.create(userId, mode, eng);
    this.audit?.({
      action: 'host_browse.session_create',
      userId,
      ok: true,
      detail: { sessionId: s.sessionId, mode, engine: eng },
    });
    return this.store.toMeta(s);
  }

  getSession(userId: string, sessionId: string): HostBrowseSessionMeta {
    const s = this.requireSession(userId, sessionId);
    return this.store.toMeta(s);
  }

  async deleteSession(userId: string, sessionId: string): Promise<void> {
    const s = this.store.get(sessionId, userId);
    if (!s) {
      throw new YskError(ErrorCodes.HOST_BROWSE_SESSION, 'Session not found', {
        httpStatus: 404,
      });
    }
    if (s.engine === 'browser') {
      await this.teardownBrowserSession(userId, sessionId);
    } else {
      this.store.delete(sessionId, userId);
    }
    this.audit?.({
      action: 'host_browse.session_delete',
      userId,
      ok: true,
      detail: { sessionId },
    });
  }

  async clearCookies(
    userId: string,
    sessionId: string,
  ): Promise<HostBrowseSessionMeta> {
    const s = this.requireSession(userId, sessionId);
    if (s.engine === 'browser') {
      await this.browser.clearCookies(sessionId);
      s.browserCookieCount = 0;
    } else {
      s.jar.clear();
    }
    return this.store.toMeta(s);
  }

  abort(userId: string, sessionId: string): void {
    if (!this.store.abort(sessionId, userId)) {
      throw new YskError(ErrorCodes.HOST_BROWSE_SESSION, 'Session not found', {
        httpStatus: 404,
      });
    }
  }

  contentPath(session: HostBrowseSession, absoluteUrl: string): string {
    const u = encodeURIComponent(absoluteUrl);
    return `/api/v1/host-browse/sessions/${session.sessionId}/content?u=${u}&ct=${encodeURIComponent(session.contentToken)}`;
  }

  formPath(session: HostBrowseSession, absoluteUrl: string): string {
    const u = encodeURIComponent(absoluteUrl);
    return `/api/v1/host-browse/sessions/${session.sessionId}/form?u=${u}&ct=${encodeURIComponent(session.contentToken)}`;
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

    if (s.engine === 'browser') {
      return this.navigateBrowser(userId, s, input);
    }
    return this.navigateProxy(userId, s, input);
  }

  /**
   * Ensure Chromium session is open (ephemeral user + downloads dir when available).
   * Shared by navigateBrowser and live ticket / WS paths.
   */
  async ensureBrowserSession(userId: string, sessionId: string): Promise<void> {
    const s = this.requireSession(userId, sessionId);
    if (!s.ephemeralUsername && this.getHost && this.getDataDir) {
      const created = await createEphemeralBrowseUser({
        host: this.getHost(),
        dataDir: this.getDataDir(),
        panelUserId: userId,
        sessionId: s.sessionId,
      });
      if (created.ok) {
        s.ephemeralUsername = created.user.username;
        s.ephemeralHomeDir = created.user.homeDir;
        this.audit?.({
          action: 'host_browse.ephemeral_user',
          userId,
          ok: true,
          detail: { username: created.user.username, sessionId: s.sessionId },
        });
      } else if (created.blocked) {
        this.audit?.({
          action: 'host_browse.ephemeral_user',
          userId,
          ok: false,
          detail: {
            sessionId: s.sessionId,
            notes: created.notes,
            requiresExecute: created.requiresExecute,
          },
        });
      }
    }

    await this.browser.openSession({
      sessionId: s.sessionId,
      userId,
      mode: s.mode,
      ephemeral:
        s.ephemeralUsername && s.ephemeralHomeDir
          ? { username: s.ephemeralUsername, homeDir: s.ephemeralHomeDir }
          : undefined,
      host: this.getHost?.(),
      dataDir: this.getDataDir?.(),
    });
  }

  private async navigateBrowser(
    userId: string,
    s: HostBrowseSession,
    input: { url?: string; action?: HostBrowseNavigateAction },
  ): Promise<HostBrowseFetchResult> {
    await this.ensureBrowserSession(userId, s.sessionId);

    const action = input.action ?? 'goto';
    let nav;
    if (action === 'back') {
      nav = await this.browser.goBack(s.sessionId);
      if (s.historyIndex > 0) s.historyIndex -= 1;
    } else if (action === 'forward') {
      nav = await this.browser.goForward(s.sessionId);
      if (s.historyIndex < s.history.length - 1) s.historyIndex += 1;
    } else if (action === 'reload') {
      nav = await this.browser.reload(s.sessionId);
    } else {
      if (!input.url) {
        throw new YskError(ErrorCodes.VALIDATION, 'URL required', {
          httpStatus: 400,
          details: { field: 'url' },
        });
      }
      const pol = this.effectivePolicy();
      const safety = evaluateNavigateSafety({
        url: input.url.startsWith('http') ? input.url : `https://${input.url}`,
        level: pol.safetyLevel ?? 'standard',
        extraBlockHosts: pol.blockHosts,
      });
      if (safety.action === 'block') {
        return {
          ok: false,
          status: 0,
          finalUrl: input.url,
          contentType: null,
          bytes: 0,
          warnings: [],
          contentPath: '',
          latencyMs: 0,
          rewritten: false,
          blocked: true,
          blockReason: safety.reason,
          engine: 'browser',
          errorCode: safety.code,
        };
      }
      nav = await this.browser.navigate(s.sessionId, input.url);
      if (safety.action === 'warn') {
        nav.warnings = [...(nav.warnings ?? []), safety.code];
      }
      if (!nav.blocked) {
        this.store.pushHistory(s, nav.finalUrl, nav.title);
        this.saveLib(
          userId,
          libPushHistory(this.libOf(userId), {
            url: nav.finalUrl,
            title: nav.title,
          }),
        );
      }
    }

    s.currentUrl = nav.finalUrl || s.currentUrl;
    s.browserCookieCount = nav.cookieCount;
    const meta = this.store.toMeta(s);

    const result: HostBrowseFetchResult = {
      ok: nav.ok && !nav.blocked,
      status: nav.status,
      finalUrl: nav.finalUrl,
      contentType: 'text/html',
      bytes: 0,
      title: nav.title,
      warnings: nav.warnings ?? [],
      contentPath: '',
      latencyMs: nav.latencyMs,
      rewritten: false,
      blocked: nav.blocked,
      blockReason: nav.blockReason,
      engine: 'browser',
      canGoBack: meta.canGoBack,
      canGoForward: meta.canGoForward,
      historyIndex: meta.historyIndex,
      historyLength: meta.historyLength,
      cookieCount: meta.cookieCount,
      errorCode: nav.errorCode,
    };

    if (result.ok && !result.blocked) {
      this.snapshotSession(userId, s.sessionId);
    }

    this.audit?.({
      action: 'host_browse.navigate',
      userId,
      ok: result.ok && !result.blocked,
      detail: {
        sessionId: s.sessionId,
        mode: s.mode,
        engine: 'browser',
        action,
        host: safeHost(result.finalUrl),
        status: result.status,
        blocked: result.blocked,
        latencyMs: result.latencyMs,
      },
    });

    return result;
  }

  private async navigateProxy(
    userId: string,
    s: HostBrowseSession,
    input: { url?: string; action?: HostBrowseNavigateAction },
  ): Promise<HostBrowseFetchResult> {
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

    const pol = this.effectivePolicy();
    const safetyUrl = targetUrl.startsWith('http')
      ? targetUrl
      : `https://${targetUrl}`;
    const safety = evaluateNavigateSafety({
      url: safetyUrl,
      level: pol.safetyLevel ?? 'standard',
      extraBlockHosts: pol.blockHosts,
    });
    if (safety.action === 'block') {
      return {
        ok: false,
        status: 0,
        finalUrl: targetUrl,
        contentType: null,
        bytes: 0,
        warnings: [],
        contentPath: '',
        latencyMs: 0,
        rewritten: false,
        blocked: true,
        blockReason: safety.reason,
        engine: 'proxy',
        errorCode: safety.code,
      };
    }

    const result = await this.fetchThroughSession(s, targetUrl!, {
      method: 'GET',
      pushHistory: action === 'goto' || action === 'reload',
      replaceHistoryUrl: action === 'back' || action === 'forward',
    });
    if (safety.action === 'warn') {
      result.warnings = [...(result.warnings ?? []), safety.code];
    }

    const meta = this.store.toMeta(s);
    result.canGoBack = meta.canGoBack;
    result.canGoForward = meta.canGoForward;
    result.historyIndex = meta.historyIndex;
    result.historyLength = meta.historyLength;
    result.cookieCount = meta.cookieCount;

    this.audit?.({
      action: 'host_browse.navigate',
      userId,
      ok: result.ok && !result.blocked,
      detail: {
        sessionId: s.sessionId,
        mode: s.mode,
        engine: 'proxy',
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
    if (s.engine === 'browser') {
      // Browser engine: navigate to form URL after note — full form automation later
      throw new YskError(
        ErrorCodes.VALIDATION,
        'Use live browser surface for forms in browser engine',
        { httpStatus: 400, details: { engine: 'browser' } },
      );
    }
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
    const maxReq = this.effectivePolicy().maxRequestBodyBytes ?? 1 * 1024 * 1024;
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

  /** Form POST from iframe (contentToken auth). */
  async submitByToken(
    sessionId: string,
    contentToken: string,
    rawUrl: string,
    body: string,
    contentType: string,
  ): Promise<HostBrowseFetchResult> {
    this.store.purgeExpired();
    const s = this.store.getById(sessionId);
    if (!s || !this.store.verifyContentToken(s, contentToken)) {
      throw new YskError(ErrorCodes.UNAUTHORIZED, 'Invalid content token', {
        httpStatus: 401,
      });
    }
    s.lastAccessAt = Date.now();
    if (s.engine !== 'proxy') {
      throw new YskError(ErrorCodes.VALIDATION, 'Form POST only for proxy engine', {
        httpStatus: 400,
      });
    }
    return this.submit(s.userId, sessionId, {
      url: rawUrl,
      method: 'POST',
      contentType,
      body,
    });
  }

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
    const pol = this.effectivePolicy();
    const ssrfOpts = {
      mode: s.mode,
      allowLoopback: pol.allowLoopback,
      extraPorts: pol.extraPorts,
    };
    const signal = this.store.beginAbortable(s);

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
          engine: 'proxy',
        };
      }
      throw e;
    }

    const maxRedirects = pol.maxRedirects ?? 5;
    const timeoutMs = pol.timeoutMs ?? 30_000;
    const maxBody = pol.maxBodyBytes ?? 8 * 1024 * 1024;
    const warnings: string[] = [];
    let method = opts.method;
    let body = opts.body;
    let contentType = opts.contentType;
    let referer = s.currentUrl;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (signal.aborted) {
        throw new YskError(ErrorCodes.HOST_BROWSE_UPSTREAM, 'Aborted', {
          httpStatus: 499,
        });
      }
      const cookie = s.jar.cookieHeaderFor(current);
      const headers = buildOutboundHeaders({
        userAgent: s.userAgent || HOST_BROWSE_DEFAULT_UA,
        acceptLanguage: pol.acceptLanguage,
        cookie: cookie || undefined,
        contentType: body != null ? contentType : undefined,
        referer,
      });

      let res: Response;
      const timer = setTimeout(() => s.abort?.abort(), timeoutMs);
      try {
        res = await fetch(current.href, {
          method,
          headers,
          body:
            body != null && method !== 'GET' && method !== 'HEAD' ? body : undefined,
          redirect: 'manual',
          signal,
        });
      } catch (e) {
        if (signal.aborted) {
          throw new YskError(ErrorCodes.HOST_BROWSE_UPSTREAM, 'Aborted', {
            httpStatus: 499,
          });
        }
        const msg = e instanceof Error ? e.message : String(e);
        throw new YskError(ErrorCodes.HOST_BROWSE_UPSTREAM, msg, {
          httpStatus: 502,
          details: { url: current.href.slice(0, 300) },
        });
      } finally {
        clearTimeout(timer);
      }

      s.jar.absorbFromResponseHeaders(res.headers, current);

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
              engine: 'proxy',
            };
          }
          throw e;
        }
        referer = current.href;
        current = next;
        if (res.status === 303 || res.status === 302 || res.status === 301) {
          method = 'GET';
          body = undefined;
          contentType = undefined;
        }
        continue;
      }

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
        contentTypeHdr === 'application/xhtml+xml';
      const isCss = contentTypeHdr.includes('text/css');

      if (isHtml) {
        let html = buf.toString('utf8');
        title = extractTitle(html);
        const { html: out, warnings: rw } = rewriteHtml(html, {
          pageUrl: current.href,
          proxyUrl: (abs) => this.contentPath(s, abs),
          formUrl: (abs) => this.formPath(s, abs),
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
        engine: 'proxy',
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
