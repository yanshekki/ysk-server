/**
 * Host-mediated proxy browser API client.
 */
import { api } from '../../shared/services/api';

export type HostBrowseMode = 'internet' | 'intranet';

export type HostBrowsePrivacy = {
  clientHeadersForwarded: boolean;
  cookieJar: 'server-only' | string;
  egress: 'host' | string;
};

export type HostBrowseSession = {
  ok?: boolean;
  sessionId: string;
  mode: HostBrowseMode;
  contentToken: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  lastAccessAt?: string;
  cookieCount: number;
  historyIndex: number;
  historyLength: number;
  currentUrl: string | null;
  privacy?: HostBrowsePrivacy;
  start?: HostBrowseNavigateResult | null;
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
  privacy?: HostBrowsePrivacy;
};

export const hostBrowseApi = {
  createSession: (body: { mode: HostBrowseMode; startUrl?: string }) =>
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
};
