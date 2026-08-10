/**
 * Host-mediated proxy browser API client.
 */
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';

export type HostBrowseMode = 'internet' | 'intranet';
export type HostBrowseEngine = 'proxy' | 'browser';

export type HostBrowsePrivacy = {
  clientHeadersForwarded: boolean;
  cookieJar: 'server-only' | string;
  egress: 'host' | string;
};

export type HostBrowseEnginePref = 'auto' | HostBrowseEngine;

export type HostBrowseSafetyLevel = 'strict' | 'standard' | 'relaxed';

export type HostBrowsePanelSettings = {
  engine: HostBrowseEnginePref;
  chromePath: string;
  allowLoopback: boolean;
  noSandbox: boolean;
  safetyLevel: HostBrowseSafetyLevel;
  blockHosts: string[];
  allowDangerousDownloads: boolean;
  /** Stream HTML media audio over live WS (PCM). Requires re-launch Chrome. */
  audioBridge: boolean;
};

export type HostBrowseCapabilities = {
  ok?: boolean;
  chromeAvailable: boolean;
  chromePath: string | null;
  engines: HostBrowseEngine[];
  defaultEngine: HostBrowseEngine;
  reason?: string;
  panel?: Partial<HostBrowsePanelSettings>;
  effective?: {
    engine: HostBrowseEnginePref;
    chromePath: string;
    allowLoopback: boolean;
    noSandbox: boolean;
  };
  media?: {
    video: 'screencast_jpeg' | 'proxy_iframe';
    audio: 'not_bridged' | 'pcm_ws';
    chromeAudioMuted: boolean;
    policy: 'visual_only' | 'visual_plus_pcm_audio';
    audioBridge: boolean;
    audioLimits?: string;
  };
};

export type HostBrowseSession = {
  ok?: boolean;
  sessionId: string;
  mode: HostBrowseMode;
  engine: HostBrowseEngine;
  contentToken: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  lastAccessAt?: string;
  cookieCount: number;
  historyIndex: number;
  historyLength: number;
  currentUrl: string | null;
  canGoBack?: boolean;
  canGoForward?: boolean;
  privacy?: HostBrowsePrivacy;
  start?: HostBrowseNavigateResult | null;
  capabilities?: HostBrowseCapabilities;
};

export type HostBrowseNavigateResult = {
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string | null;
  bytes: number;
  title?: string;
  warnings: string[];
  contentPath: string;
  latencyMs: number;
  rewritten: boolean;
  blocked?: boolean;
  blockReason?: string;
  engine?: HostBrowseEngine;
  canGoBack?: boolean;
  canGoForward?: boolean;
  historyIndex?: number;
  historyLength?: number;
  cookieCount?: number;
  privacy?: HostBrowsePrivacy;
  errorCode?: string;
};

export type HostBrowseLiveTicket = {
  ok: boolean;
  ticket: string;
  expiresAt: string;
  wsPath: string;
};

export const hostBrowseApi = {
  capabilities: () =>
    api.requestRaw<HostBrowseCapabilities>('/api/v1/host-browse/capabilities'),

  createSession: (body: {
    mode: HostBrowseMode;
    engine?: HostBrowseEngine;
    startUrl?: string;
  }) =>
    api.requestRaw<HostBrowseSession>('/api/v1/host-browse/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSession: (sessionId: string) =>
    api.requestRaw<HostBrowseSession>(
      `/api/v1/host-browse/sessions/${encodeURIComponent(sessionId)}`,
    ),

  deleteSession: (sessionId: string) =>
    api.requestRaw<{ ok: boolean }>(
      `/api/v1/host-browse/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
    ),

  clearCookies: (sessionId: string) =>
    api.requestRaw<HostBrowseSession>(
      `/api/v1/host-browse/sessions/${encodeURIComponent(sessionId)}/clear-cookies`,
      { method: 'POST', body: '{}' },
    ),

  abort: (sessionId: string) =>
    api.requestRaw<{ ok: boolean }>(
      `/api/v1/host-browse/sessions/${encodeURIComponent(sessionId)}/abort`,
      { method: 'POST', body: '{}' },
    ),

  navigate: (
    sessionId: string,
    body: {
      url?: string;
      action?: 'goto' | 'reload' | 'back' | 'forward';
    },
  ) =>
    api.requestRaw<HostBrowseNavigateResult>(
      `/api/v1/host-browse/sessions/${encodeURIComponent(sessionId)}/navigate`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  submit: (
    sessionId: string,
    body: {
      url: string;
      method?: string;
      contentType?: string;
      body?: string;
    },
  ) =>
    api.requestRaw<HostBrowseNavigateResult>(
      `/api/v1/host-browse/sessions/${encodeURIComponent(sessionId)}/submit`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  liveTicket: (sessionId: string) =>
    api.requestRaw<HostBrowseLiveTicket>(
      `/api/v1/host-browse/sessions/${encodeURIComponent(sessionId)}/live`,
      { method: 'POST', body: '{}' },
    ),

  getSettings: () =>
    api.requestRaw<{
      ok: boolean;
      settings: HostBrowsePanelSettings;
      capabilities: HostBrowseCapabilities;
      envHints?: Record<string, string | null>;
    }>('/api/v1/settings/host-browse'),

  saveSettings: (body: Partial<HostBrowsePanelSettings>) =>
    api.requestRaw<{
      ok: boolean;
      settings: HostBrowsePanelSettings;
      capabilities: HostBrowseCapabilities;
    }>('/api/v1/settings/host-browse', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  library: () =>
    api.requestRaw<{
      ok: boolean;
      library: {
        homeUrl: string;
        bookmarks: Array<{ id: string; title: string; url: string }>;
        history: Array<{ id: string; title: string; url: string; at: string }>;
        lastSnapshot?: HostBrowseLastSnapshot;
      };
    }>('/api/v1/host-browse/library'),

  clearLastSnapshot: () =>
    api.requestRaw<{ ok: boolean; library: { homeUrl?: string } }>(
      '/api/v1/host-browse/last-snapshot',
      { method: 'DELETE' },
    ),

  setHome: (homeUrl: string) =>
    api.requestRaw<{ ok: boolean; library: { homeUrl: string } }>(
      '/api/v1/host-browse/home',
      { method: 'PUT', body: JSON.stringify({ homeUrl }) },
    ),

  toggleBookmark: (body: { url: string; title?: string }) =>
    api.requestRaw<{
      ok: boolean;
      library: {
        bookmarks: Array<{ id: string; title: string; url: string }>;
      };
    }>('/api/v1/host-browse/bookmarks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  heartbeat: (sessionId: string) =>
    api.requestRaw<{ ok: boolean }>(
      `/api/v1/host-browse/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
      { method: 'POST', body: '{}' },
    ),

  listDownloads: (sessionId: string) =>
    api.requestRaw<{
      ok: boolean;
      downloads: HostBrowseDownload[];
    }>(
      `/api/v1/host-browse/sessions/${encodeURIComponent(sessionId)}/downloads`,
    ),

  /** Authenticated download URL (use with token header via fetch helper). */
  downloadFilePath: (sessionId: string, downloadId: string) =>
    `/api/v1/host-browse/sessions/${encodeURIComponent(sessionId)}/downloads/${encodeURIComponent(downloadId)}`,
};

export type HostBrowseDownload = {
  id: string;
  sessionId: string;
  filename: string;
  sourceUrl: string;
  mime: string | null;
  size: number;
  status: 'pending' | 'completed' | 'blocked' | 'failed';
  reason?: string;
  createdAt: string;
  finishedAt?: string;
  hasFile: boolean;
};

export type HostBrowseLastSnapshot = {
  tabs: Array<{ url: string; title?: string }>;
  activeIndex: number;
  mode?: string;
  engine?: string;
  updatedAt?: string;
};

export function hostBrowseLiveWsUrl(wsPath: string): string {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  if (wsPath.startsWith('ws://') || wsPath.startsWith('wss://')) return wsPath;
  return `${proto}//${loc.host}${wsPath.startsWith('/') ? wsPath : `/${wsPath}`}`;
}

/** Unused helper kept for parity with terminal token attachment */
export function withAuthToken(wsPath: string): string {
  const token = authStore.getToken();
  if (!token || wsPath.includes('ticket=')) return wsPath;
  const sep = wsPath.includes('?') ? '&' : '?';
  return `${wsPath}${sep}token=${encodeURIComponent(token)}`;
}
