/**
 * Host Chromium engine via playwright-core + system Chrome.
 * Screencast (CDP) + mouse/keyboard for real browsing feel.
 */

import { ErrorCodes, YskError } from '@ysk/shared';
import { probeChrome } from './chrome-probe.js';
import { assertHostBrowseTarget } from './ssrf.js';
import type { HostBrowseMode, HostBrowsePolicy } from './types.js';
import { HOST_BROWSE_DEFAULT_UA } from './types.js';
import {
  clampViewport,
  detectBotChallenge,
  resolveStreamOptions,
  screencastSize,
  type StreamOptions,
  type StreamPresetId,
} from './stream-presets.js';

type PlaywrightModule = typeof import('playwright-core');
type Browser = import('playwright-core').Browser;
type BrowserContext = import('playwright-core').BrowserContext;
type Page = import('playwright-core').Page;
type CDPSession = import('playwright-core').CDPSession;

export type BrowserSessionHandle = {
  sessionId: string;
  userId: string;
  mode: HostBrowseMode;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession | null;
  screencastOn: boolean;
  viewport: { w: number; h: number };
  stream: StreamOptions;
  onFrame?: (frame: {
    mime: string;
    data: Buffer;
    width: number;
    height: number;
  }) => void;
  onMeta?: (meta: { url: string; title: string }) => void;
};

export type BrowserNavResult = {
  ok: boolean;
  status: number;
  finalUrl: string;
  title: string;
  latencyMs: number;
  blocked?: boolean;
  blockReason?: string;
  cookieCount: number;
  warnings: string[];
  errorCode?: string;
};

let playwrightMod: PlaywrightModule | null = null;

async function loadPlaywright(): Promise<PlaywrightModule> {
  if (playwrightMod) return playwrightMod;
  try {
    playwrightMod = await import('playwright-core');
    return playwrightMod;
  } catch {
    throw new YskError(
      ErrorCodes.HOST_BROWSE_NEED_CHROME,
      'playwright-core is not installed',
      { httpStatus: 503, details: { reason: 'missing_playwright' } },
    );
  }
}

export class BrowserEngine {
  private browser: Browser | null = null;
  private handles = new Map<string, BrowserSessionHandle>();
  private launching: Promise<Browser> | null = null;

  constructor(private readonly getPolicy: () => HostBrowsePolicy = () => ({})) {}

  private policy(): HostBrowsePolicy {
    return this.getPolicy();
  }

  get activeCount(): number {
    return this.handles.size;
  }

  /** Close browser so next ensure re-reads chrome path / sandbox flags. */
  async invalidateBrowser(): Promise<void> {
    for (const id of [...this.handles.keys()]) {
      await this.closeSession(id);
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* */
      }
      this.browser = null;
    }
  }

  async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      const pw = await loadPlaywright();
      const pol = this.policy();
      const probe = probeChrome(true);
      const path = pol.chromePath || probe.path;
      if (!path) {
        throw new YskError(
          ErrorCodes.HOST_BROWSE_NEED_CHROME,
          probe.reason || 'Chrome not available',
          { httpStatus: 503, details: { reason: 'no_chrome' } },
        );
      }
      const noSandbox =
        pol.noSandbox === true ||
        process.env.YSK_HOST_BROWSE_NO_SANDBOX === '1' ||
        process.env.YSK_HOST_BROWSE_NO_SANDBOX === 'true';
      const browser = await pw.chromium.launch({
        executablePath: path,
        headless: true,
        args: [
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync',
          '--metrics-recording-only',
          '--mute-audio',
          ...(noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
        ],
      });
      this.browser = browser;
      browser.on('disconnected', () => {
        this.browser = null;
        this.handles.clear();
      });
      return browser;
    })();

    try {
      return await this.launching;
    } finally {
      this.launching = null;
    }
  }

  async openSession(input: {
    sessionId: string;
    userId: string;
    mode: HostBrowseMode;
  }): Promise<void> {
    const max = this.policy().maxBrowserSessions ?? 4;
    if (this.handles.size >= max && !this.handles.has(input.sessionId)) {
      throw new YskError(ErrorCodes.RATE_LIMITED, 'Too many browser sessions', {
        httpStatus: 429,
      });
    }
    if (this.handles.has(input.sessionId)) return;

    const browser = await this.ensureBrowser();
    const pol = this.policy();
    const vp = { w: 1280, h: 800 };
    const context = await browser.newContext({
      userAgent: pol.userAgent ?? HOST_BROWSE_DEFAULT_UA,
      locale: 'en-US',
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: input.mode === 'intranet',
      javaScriptEnabled: true,
      permissions: [],
    });
    await context.setExtraHTTPHeaders({
      'Accept-Language': pol.acceptLanguage ?? 'en-US,en;q=0.9',
    });

    const page = await context.newPage();
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      void assertHostBrowseTarget(frame.url(), {
        mode: input.mode,
        allowLoopback: this.policy().allowLoopback,
        extraPorts: this.policy().extraPorts,
      }).catch(() => {
        /* mid-flight */
      });
    });

    this.handles.set(input.sessionId, {
      sessionId: input.sessionId,
      userId: input.userId,
      mode: input.mode,
      context,
      page,
      cdp: null,
      screencastOn: false,
      viewport: vp,
      stream: resolveStreamOptions({ preset: 'balanced' }),
    });
  }

  getHandle(sessionId: string): BrowserSessionHandle | null {
    return this.handles.get(sessionId) ?? null;
  }

  async navigate(
    sessionId: string,
    rawUrl: string,
  ): Promise<BrowserNavResult> {
    const h = this.handles.get(sessionId);
    if (!h) {
      throw new YskError(ErrorCodes.HOST_BROWSE_SESSION, 'Browser session missing', {
        httpStatus: 404,
      });
    }
    const started = Date.now();
    let url: URL;
    try {
      url = await assertHostBrowseTarget(rawUrl, {
        mode: h.mode,
        allowLoopback: this.policy().allowLoopback,
        extraPorts: this.policy().extraPorts,
      });
    } catch (e) {
      if (e instanceof YskError && e.code === ErrorCodes.HOST_BROWSE_SSRF) {
        return {
          ok: false,
          status: 0,
          finalUrl: rawUrl,
          title: '',
          latencyMs: Date.now() - started,
          blocked: true,
          blockReason: String(
            (e.details as { reason?: string } | undefined)?.reason ?? 'ssrf',
          ),
          cookieCount: 0,
          warnings: [],
          errorCode: 'SSRF_BLOCKED',
        };
      }
      throw e;
    }

    try {
      const resp = await h.page.goto(url.href, {
        waitUntil: 'domcontentloaded',
        timeout: this.policy().timeoutMs ?? 30_000,
      });
      await delay(500);
      return await this.snapshotNav(h, started, resp?.status() ?? 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = /timeout/i.test(msg)
        ? 'TIMEOUT'
        : /SSL|certificate|TLS/i.test(msg)
          ? 'TLS_FAIL'
          : /net::|DNS|ENOTFOUND|getaddrinfo/i.test(msg)
            ? 'DNS_FAIL'
            : 'NAV_FAIL';
      throw new YskError(ErrorCodes.HOST_BROWSE_UPSTREAM, msg, {
        httpStatus: 502,
        details: { errorCode: code },
      });
    }
  }

  async goBack(sessionId: string): Promise<BrowserNavResult> {
    const h = this.require(sessionId);
    const started = Date.now();
    await h.page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
    await delay(300);
    return this.snapshotNav(h, started, 200);
  }

  async goForward(sessionId: string): Promise<BrowserNavResult> {
    const h = this.require(sessionId);
    const started = Date.now();
    await h.page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
    await delay(300);
    return this.snapshotNav(h, started, 200);
  }

  async reload(sessionId: string): Promise<BrowserNavResult> {
    const h = this.require(sessionId);
    const started = Date.now();
    await h.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await delay(300);
    return this.snapshotNav(h, started, 200);
  }

  private async snapshotNav(
    h: BrowserSessionHandle,
    started: number,
    status: number,
  ): Promise<BrowserNavResult> {
    const cookies = await h.context.cookies();
    const title = await h.page.title();
    const finalUrl = h.page.url();
    const warnings: string[] = [];
    if (detectBotChallenge(title, finalUrl)) {
      warnings.push('possible_bot_challenge');
    }
    try {
      const html = await h.page.content();
      if (html.replace(/<[^>]+>/g, '').trim().length < 40) {
        warnings.push('empty_document');
      }
    } catch {
      /* */
    }
    h.onMeta?.({ url: finalUrl, title });
    return {
      ok: status >= 200 && status < 400,
      status,
      finalUrl,
      title,
      latencyMs: Date.now() - started,
      cookieCount: cookies.length,
      warnings,
      errorCode:
        status >= 400 ? `NAV_HTTP_${status}` : warnings.includes('possible_bot_challenge')
          ? 'BOT_CHALLENGE'
          : undefined,
    };
  }

  async cookieCount(sessionId: string): Promise<number> {
    const h = this.handles.get(sessionId);
    if (!h) return 0;
    return (await h.context.cookies()).length;
  }

  async clearCookies(sessionId: string): Promise<void> {
    const h = this.require(sessionId);
    await h.context.clearCookies();
  }

  /**
   * Start or restart screencast. Always tears down previous CDP session first
   * so re-navigate / quality change never sticks on screencastOn=true.
   */
  async startScreencast(
    sessionId: string,
    onFrame: BrowserSessionHandle['onFrame'],
    streamPartial?: Partial<StreamOptions> & { preset?: StreamPresetId },
  ): Promise<StreamOptions> {
    const h = this.require(sessionId);
    if (streamPartial) {
      h.stream = resolveStreamOptions({ ...h.stream, ...streamPartial });
    }
    h.onFrame = onFrame;
    await this.stopScreencast(sessionId, false);

    const cdp = await h.page.context().newCDPSession(h.page);
    h.cdp = cdp;
    const vp = h.viewport;
    cdp.on('Page.screencastFrame', (frame: {
      data: string;
      sessionId: number;
      metadata?: { deviceWidth?: number; deviceHeight?: number };
    }) => {
      const buf = Buffer.from(frame.data, 'base64');
      h.onFrame?.({
        mime: 'image/jpeg',
        data: buf,
        width: frame.metadata?.deviceWidth ?? vp.w,
        height: frame.metadata?.deviceHeight ?? vp.h,
      });
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    });
    const cast = screencastSize(vp, h.stream);
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: h.stream.quality,
      maxWidth: cast.maxWidth,
      maxHeight: cast.maxHeight,
      everyNthFrame: h.stream.everyNthFrame,
    });
    h.screencastOn = true;
    return { ...h.stream };
  }

  async stopScreencast(sessionId: string, clearHandler = true): Promise<void> {
    const h = this.handles.get(sessionId);
    if (!h) return;
    if (h.cdp) {
      try {
        if (h.screencastOn) await h.cdp.send('Page.stopScreencast');
      } catch {
        /* */
      }
      try {
        await h.cdp.detach();
      } catch {
        /* */
      }
    }
    h.cdp = null;
    h.screencastOn = false;
    if (clearHandler) h.onFrame = undefined;
  }

  async setStreamOptions(
    sessionId: string,
    partial: Partial<StreamOptions> & { preset?: StreamPresetId },
  ): Promise<StreamOptions> {
    const h = this.require(sessionId);
    h.stream = resolveStreamOptions({ ...h.stream, ...partial });
    if (h.onFrame) {
      await this.startScreencast(sessionId, h.onFrame);
    }
    return { ...h.stream };
  }

  getStreamOptions(sessionId: string): StreamOptions | null {
    const h = this.handles.get(sessionId);
    return h ? { ...h.stream } : null;
  }

  async mouse(
    sessionId: string,
    ev: {
      type: 'move' | 'down' | 'up' | 'click' | 'wheel';
      x: number;
      y: number;
      button?: 'left' | 'right' | 'middle';
      deltaX?: number;
      deltaY?: number;
    },
  ): Promise<void> {
    const h = this.require(sessionId);
    const btn = ev.button ?? 'left';
    if (ev.type === 'move') await h.page.mouse.move(ev.x, ev.y);
    else if (ev.type === 'down') await h.page.mouse.down({ button: btn });
    else if (ev.type === 'up') await h.page.mouse.up({ button: btn });
    else if (ev.type === 'click') await h.page.mouse.click(ev.x, ev.y, { button: btn });
    else if (ev.type === 'wheel')
      await h.page.mouse.wheel(ev.deltaX ?? 0, ev.deltaY ?? 0);
  }

  async keyboard(
    sessionId: string,
    ev: { type: 'down' | 'up' | 'press' | 'type'; key?: string; text?: string },
  ): Promise<void> {
    const h = this.require(sessionId);
    if (ev.type === 'type' && ev.text) await h.page.keyboard.type(ev.text, { delay: 10 });
    else if (ev.type === 'press' && ev.key) await h.page.keyboard.press(ev.key);
    else if (ev.type === 'down' && ev.key) await h.page.keyboard.down(ev.key);
    else if (ev.type === 'up' && ev.key) await h.page.keyboard.up(ev.key);
  }

  async resize(
    sessionId: string,
    width: number,
    height: number,
    opts?: { restartCast?: boolean },
  ): Promise<{ w: number; h: number; stream: StreamOptions }> {
    const h = this.require(sessionId);
    const { w, h: ht } = clampViewport(width, height);
    h.viewport = { w, h: ht };
    await h.page.setViewportSize({ width: w, height: ht });
    if (opts?.restartCast !== false && h.onFrame) {
      await this.startScreencast(sessionId, h.onFrame);
    }
    return { w, h: ht, stream: { ...h.stream } };
  }

  async closeSession(sessionId: string): Promise<void> {
    const h = this.handles.get(sessionId);
    if (!h) return;
    await this.stopScreencast(sessionId);
    try {
      await h.context.close();
    } catch {
      /* */
    }
    this.handles.delete(sessionId);
  }

  async dispose(): Promise<void> {
    for (const id of [...this.handles.keys()]) {
      await this.closeSession(id);
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* */
      }
      this.browser = null;
    }
  }

  private require(sessionId: string): BrowserSessionHandle {
    const h = this.handles.get(sessionId);
    if (!h) {
      throw new YskError(ErrorCodes.HOST_BROWSE_SESSION, 'Browser session missing', {
        httpStatus: 404,
      });
    }
    return h;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
