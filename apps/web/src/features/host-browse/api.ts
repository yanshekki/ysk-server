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

export type HostBrowseCapabilities = {
  ok?: boolean;
  chromeAvailable: boolean;
  chromePath: string | null;
  engines: HostBrowseEngine[];
  defaultEngine: HostBrowseEngine;
  reason?: string;
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
