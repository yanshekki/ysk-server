/**
 * Host-mediated proxy browser — shared types (core).
 */

export type HostBrowseMode = 'internet' | 'intranet';

/** proxy = HTTP rewrite iframe; browser = host Chromium screencast */
export type HostBrowseEngine = 'proxy' | 'browser';

export type HostBrowseNavigateAction = 'goto' | 'reload' | 'back' | 'forward';

export const HOST_BROWSE_DEFAULT_UA =
  'YSK-HostBrowse/1.0 (+https://ysk; host-mediated; privacy)';

export const HOST_BROWSE_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

export const HOST_BROWSE_ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

export interface HostBrowsePolicy {
  /** Fixed User-Agent for all egress (never client UA). */
  userAgent?: string;
  acceptLanguage?: string;
  /** Max response body bytes buffered (default 8 MiB). */
  maxBodyBytes?: number;
  /** Max request body for submit (default 1 MiB). */
  maxRequestBodyBytes?: number;
  /** Total fetch timeout ms (default 30_000). */
  timeoutMs?: number;
  /** Max redirects (default 5). */
  maxRedirects?: number;
  /** Idle session TTL ms (default 30 min). */
  idleTtlMs?: number;
  /** Absolute max session lifetime ms (default 4 h). */
  maxLifetimeMs?: number;
  /** Concurrent sessions per user (default 4). */
  maxSessionsPerUser?: number;
  /** Allow loopback in intranet mode (default false). */
  allowLoopback?: boolean;
  /** Extra allowed ports beyond 80/443 (intranet common admin ports). */
  extraPorts?: number[];
  /** Rate limit: max navigations per user per minute (default 60). */
  rateLimitPerMinute?: number;
  /** Override Chrome executable path */
  chromePath?: string;
  /** Max concurrent browser-engine sessions (default 4). */
  maxBrowserSessions?: number;
  /** Default engine when client omits (default auto→browser if chrome). */
  defaultEngine?: HostBrowseEngine | 'auto';
}

export interface HostBrowseHistoryEntry {
  url: string;
  title?: string;
  at: string;
}

export interface HostBrowseSessionMeta {
  sessionId: string;
  userId: string;
  mode: HostBrowseMode;
  engine: HostBrowseEngine;
  contentToken: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  lastAccessAt: string;
  cookieCount: number;
  historyIndex: number;
  historyLength: number;
  currentUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface HostBrowseFetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string | null;
  bytes: number;
  title?: string;
  warnings: string[];
  /** Absolute path for iframe content (proxy engine; includes content token). */
  contentPath: string;
  latencyMs: number;
  /** True when body is HTML and was rewritten for proxy. */
  rewritten: boolean;
  blocked?: boolean;
  blockReason?: string;
  engine: HostBrowseEngine;
  canGoBack?: boolean;
  canGoForward?: boolean;
  historyIndex?: number;
  historyLength?: number;
  cookieCount?: number;
}

export interface HostBrowseContentResult {
  status: number;
  finalUrl: string;
  contentType: string;
  body: Buffer;
  rewritten: boolean;
  warnings: string[];
  headers: Record<string, string>;
}

export interface HostBrowseCapabilities {
  chromeAvailable: boolean;
  chromePath: string | null;
  engines: HostBrowseEngine[];
  defaultEngine: HostBrowseEngine;
  reason?: string;
}
