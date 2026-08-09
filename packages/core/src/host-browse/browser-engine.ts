/**
 * Host Chromium engine via playwright-core + system Chrome.
 * Screencast (CDP) + mouse/keyboard for real browsing feel.
 */

import { ErrorCodes, YskError } from '@ysk/shared';
import { probeChrome } from './chrome-probe.js';
import { assertHostBrowseTarget } from './ssrf.js';
import type { HostBrowseMode, HostBrowsePolicy } from './types.js';
import { HOST_BROWSE_DEFAULT_UA } from './types.js';

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

  constructor(private readonly policy: HostBrowsePolicy = {}) {}

  get activeCount(): number {
    return this.handles.size;
  }

  async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      const pw = await loadPlaywright();
      const probe = probeChrome();
      const path = this.policy.chromePath || probe.path;
      if (!path) {
        throw new YskError(
          ErrorCodes.HOST_BROWSE_NEED_CHROME,
          probe.reason || 'Chrome not available',
          { httpStatus: 503, details: { reason: 'no_chrome' } },
        );
      }
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
          // container-friendly when needed
          ...(process.env.YSK_HOST_BROWSE_NO_SANDBOX === '1'
            ? ['--no-sandbox', '--disable-setuid-sandbox']
            : []),
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
    const max = this.policy.maxBrowserSessions ?? 4;
    if (this.handles.size >= max && !this.handles.has(input.sessionId)) {
      throw new YskError(ErrorCodes.RATE_LIMITED, 'Too many browser sessions', {
        httpStatus: 429,
      });
    }
    if (this.handles.has(input.sessionId)) return;

    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      userAgent: this.policy.userAgent ?? HOST_BROWSE_DEFAULT_UA,
      locale: 'en-US',
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: input.mode === 'intranet',
      javaScriptEnabled: true,
      // No geolocation / notifications
      permissions: [],
    });
    // Extra privacy: strip extra client-like headers we never set
    await context.setExtraHTTPHeaders({
      'Accept-Language': this.policy.acceptLanguage ?? 'en-US,en;q=0.9',
    });

    const page = await context.newPage();
    // SSRF gate on every document navigation
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      void assertHostBrowseTarget(frame.url(), {
        mode: input.mode,
        allowLoopback: this.policy.allowLoopback,
        extraPorts: this.policy.extraPorts,
      }).catch(() => {
        /* navigation may be mid-flight; navigate() also gates */
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
        allowLoopback: this.policy.allowLoopback,
        extraPorts: this.policy.extraPorts,
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
        };
      }
      throw e;
    }

    try {
      const resp = await h.page.goto(url.href, {
        waitUntil: 'domcontentloaded',
        timeout: this.policy.timeoutMs ?? 30_000,
      });
      // Wait a bit for paint
      await delay(400);
      const cookies = await h.context.cookies();
      const title = await h.page.title();
      const finalUrl = h.page.url();
      h.onMeta?.({ url: finalUrl, title });
      return {
        ok: Boolean(resp?.ok() ?? true),
        status: resp?.status() ?? 200,
        finalUrl,
        title,
        latencyMs: Date.now() - started,
        cookieCount: cookies.length,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new YskError(ErrorCodes.HOST_BROWSE_UPSTREAM, msg, {
        httpStatus: 502,
      });
    }
  }

  async goBack(sessionId: string): Promise<BrowserNavResult> {
    const h = this.require(sessionId);
    const started = Date.now();
    await h.page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
    await delay(300);
    const cookies = await h.context.cookies();
    return {
      ok: true,
      status: 200,
      finalUrl: h.page.url(),
      title: await h.page.title(),
      latencyMs: Date.now() - started,
      cookieCount: cookies.length,
    };
  }

  async goForward(sessionId: string): Promise<BrowserNavResult> {
    const h = this.require(sessionId);
    const started = Date.now();
    await h.page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
    await delay(300);
    const cookies = await h.context.cookies();
    return {
      ok: true,
      status: 200,
      finalUrl: h.page.url(),
      title: await h.page.title(),
      latencyMs: Date.now() - started,
      cookieCount: cookies.length,
    };
  }

  async reload(sessionId: string): Promise<BrowserNavResult> {
    const h = this.require(sessionId);
    const started = Date.now();
    await h.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await delay(300);
    const cookies = await h.context.cookies();
    return {
      ok: true,
      status: 200,
      finalUrl: h.page.url(),
      title: await h.page.title(),
      latencyMs: Date.now() - started,
      cookieCount: cookies.length,
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

  async startScreencast(
    sessionId: string,
    onFrame: BrowserSessionHandle['onFrame'],
  ): Promise<void> {
    const h = this.require(sessionId);
    h.onFrame = onFrame;
    if (h.screencastOn) return;

    const cdp = await h.page.context().newCDPSession(h.page);
    h.cdp = cdp;
    cdp.on('Page.screencastFrame', (frame: {
      data: string;
      sessionId: number;
      metadata?: { deviceWidth?: number; deviceHeight?: number };
    }) => {
      const buf = Buffer.from(frame.data, 'base64');
      h.onFrame?.({
        mime: 'image/jpeg',
        data: buf,
        width: frame.metadata?.deviceWidth ?? 1280,
        height: frame.metadata?.deviceHeight ?? 800,
      });
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 50,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 2,
    });
    h.screencastOn = true;
  }

  async stopScreencast(sessionId: string): Promise<void> {
    const h = this.handles.get(sessionId);
    if (!h?.screencastOn || !h.cdp) return;
    try {
      await h.cdp.send('Page.stopScreencast');
    } catch {
      /* */
    }
    try {
      await h.cdp.detach();
    } catch {
      /* */
    }
    h.cdp = null;
    h.screencastOn = false;
    h.onFrame = undefined;
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

  async resize(sessionId: string, width: number, height: number): Promise<void> {
    const h = this.require(sessionId);
    const w = Math.max(320, Math.min(1920, Math.floor(width)));
    const ht = Math.max(240, Math.min(1200, Math.floor(height)));
    await h.page.setViewportSize({ width: w, height: ht });
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
