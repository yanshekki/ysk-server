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
  /** Pass --no-sandbox to Chromium (containers). */
  noSandbox?: boolean;
  /** Content safety level (navigate + downloads). */
  safetyLevel?: 'strict' | 'standard' | 'relaxed';
  /** Extra hosts blocked by safety policy. */
  blockHosts?: string[];
  /** Allow potentially dangerous download extensions. */
  allowDangerousDownloads?: boolean;
}

/** Panel-persisted settings (DB) — override process env. */
export type HostBrowsePanelConfig = {
  engine?: 'auto' | HostBrowseEngine;
  chromePath?: string;
  allowLoopback?: boolean;
  noSandbox?: boolean;
  safetyLevel?: 'strict' | 'standard' | 'relaxed';
  /** Comma or newline separated hostnames */
  blockHosts?: string[];
  allowDangerousDownloads?: boolean;
};

export function mergeHostBrowsePolicy(
  base: HostBrowsePolicy,
  panel?: HostBrowsePanelConfig | null,
  env: Record<string, string | undefined> = process.env,
): HostBrowsePolicy {
  const eng =
    panel?.engine ??
    (env.YSK_HOST_BROWSE_ENGINE as HostBrowsePanelConfig['engine'] | undefined) ??
    base.defaultEngine ??
    'auto';
  const level =
    panel?.safetyLevel === 'strict' ||
    panel?.safetyLevel === 'standard' ||
    panel?.safetyLevel === 'relaxed'
      ? panel.safetyLevel
      : base.safetyLevel ?? 'standard';
  return {
    ...base,
    chromePath:
      (panel?.chromePath && panel.chromePath.trim()) ||
      env.YSK_HOST_BROWSE_CHROME?.trim() ||
      base.chromePath,
    allowLoopback:
      panel?.allowLoopback ??
      (env.YSK_HOST_BROWSE_LOOPBACK === '1' || env.YSK_HOST_BROWSE_LOOPBACK === 'true'
        ? true
        : base.allowLoopback),
    noSandbox:
      panel?.noSandbox ??
      (env.YSK_HOST_BROWSE_NO_SANDBOX === '1' || env.YSK_HOST_BROWSE_NO_SANDBOX === 'true'
        ? true
        : base.noSandbox),
    defaultEngine: eng === 'auto' ? 'auto' : eng,
    safetyLevel: level,
    blockHosts: panel?.blockHosts?.length
      ? panel.blockHosts.map((h) => h.trim().toLowerCase()).filter(Boolean)
      : base.blockHosts,
    allowDangerousDownloads:
      panel?.allowDangerousDownloads ?? base.allowDangerousDownloads ?? false,
  };
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
  /** Stable error / warning codes for UI (BOT_CHALLENGE, TIMEOUT, …) */
  errorCode?: string;
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
  /** Raw panel settings (may be empty) */
  panel?: HostBrowsePanelConfig;
  /** Effective values after merge with env */
  effective?: {
    engine: 'auto' | HostBrowseEngine;
    chromePath: string;
    allowLoopback: boolean;
    noSandbox: boolean;
  };
  /**
   * Honest media surface: browser engine streams visual frames only.
   * Audio is intentionally not bridged to the panel (phase-2).
   */
  media?: {
    video: 'screencast_jpeg' | 'proxy_iframe';
    audio: 'not_bridged';
    chromeAudioMuted: true;
    policy: 'visual_only';
  };
}
