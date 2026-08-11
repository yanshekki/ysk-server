/**
 * VNC server + client API client.
 */
import { api } from '../../shared/services/api';

export type VncDesktopProfile = 'xfce' | 'terminal';
export type VncRfbBind = 'localhost' | 'all';
export type VncConnectPath = 'via_server' | 'direct';
export type VncStackId = 'tigervnc' | 'novnc' | 'xfce' | 'viewer';

export type VncStackStatus = {
  id: VncStackId;
  title: string;
  installed: boolean;
  bins: string[];
  missingBins: string[];
  notes: string[];
};

export type VncSettings = {
  defaultDesktop: VncDesktopProfile;
  defaultGeometry: string;
  defaultDepth: number;
  defaultRfbBind: VncRfbBind;
  defaultAutostart: boolean;
  displayMin: number;
  displayMax: number;
};

export type VncAccountSummary = {
  id: string;
  name: string;
  linuxUser: string;
  display: number;
  rfbPort: number;
  desktop: VncDesktopProfile;
  status: string;
  rfbBind: VncRfbBind;
  geometry: string;
  depth: number;
  autostart: boolean;
  hasPassword: boolean;
  novncRunning: boolean;
  createdAt: string;
};

export type VncClientProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  path: VncConnectPath;
  status: string;
  autostart: boolean;
  createdAt: string;
};

export type VncStatusResponse = {
  ok: boolean;
  stacks: VncStackStatus[];
  accountCount: number;
  runningCount: number;
  clientProfileCount: number;
  clientConnectedCount: number;
  settings: VncSettings;
  endpointHint: string | null;
  executeEnabled: boolean;
  isRoot: boolean;
  notes: string[];
  accounts: VncAccountSummary[];
  clientProfiles: VncClientProfile[];
};

export type VncOpsResult = {
  ok: boolean;
  notes?: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  account?: VncAccountSummary;
  apply_status?: string;
};

export const vncApi = {
  status: () => api.requestRaw<VncStatusResponse>('/api/v1/vnc/status'),
  getSettings: () =>
    api.requestRaw<{ ok: boolean; settings: VncSettings }>('/api/v1/vnc/settings'),
  patchSettings: (body: Partial<VncSettings>) =>
    api.requestRaw<{ ok: boolean; settings: VncSettings }>('/api/v1/vnc/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listAccounts: () =>
    api.requestRaw<{ ok: boolean; items: VncAccountSummary[] }>('/api/v1/vnc/accounts'),
  createAccount: (body: {
    name: string;
    password?: string;
    desktop?: VncDesktopProfile;
    geometry?: string;
    depth?: number;
    rfbBind?: VncRfbBind;
    autostart?: boolean;
    display?: number;
    start?: boolean;
  }) =>
    api.requestRawAllowStatus<VncOpsResult>('/api/v1/vnc/accounts', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
    }),
  updateAccount: (
    id: string,
    body: {
      name?: string;
      desktop?: VncDesktopProfile;
      geometry?: string;
      depth?: number;
      rfbBind?: VncRfbBind;
      autostart?: boolean;
    },
  ) =>
    api.requestRawAllowStatus<VncOpsResult>(
      `/api/v1/vnc/accounts/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body), allowStatuses: [403, 422] },
    ),
  setPassword: (id: string, password: string) =>
    api.requestRawAllowStatus<VncOpsResult>(
      `/api/v1/vnc/accounts/${encodeURIComponent(id)}/password`,
      {
        method: 'POST',
        body: JSON.stringify({ password }),
        allowStatuses: [403, 422],
      },
    ),
  startAccount: (id: string) =>
    api.requestRawAllowStatus<VncOpsResult>(
      `/api/v1/vnc/accounts/${encodeURIComponent(id)}/start`,
      { method: 'POST', body: '{}', allowStatuses: [403, 422] },
    ),
  stopAccount: (id: string) =>
    api.requestRawAllowStatus<VncOpsResult>(
      `/api/v1/vnc/accounts/${encodeURIComponent(id)}/stop`,
      { method: 'POST', body: '{}', allowStatuses: [403, 422] },
    ),
  deleteAccount: (id: string, body?: { removeLinuxUser?: boolean }) =>
    api.requestRawAllowStatus<VncOpsResult>(
      `/api/v1/vnc/accounts/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        body: JSON.stringify(body ?? {}),
        allowStatuses: [403, 422],
      },
    ),
  getConnection: (id: string) =>
    api.requestRaw<{
      ok: boolean;
      account: VncAccountSummary;
      connection: {
        direct: {
          host: string;
          port: number;
          display: number;
          address: string;
          bind: string;
          recommended: boolean;
          notes: string[];
        };
        viaServer: {
          available: boolean;
          httpPort: number | null;
          localUrl: string | null;
          ticketPath: string | null;
          recommended: boolean;
          notes: string[];
        };
      };
      notes: string[];
    }>(`/api/v1/vnc/accounts/${encodeURIComponent(id)}/connection`),
  startNovnc: (id: string) =>
    api.requestRawAllowStatus<VncOpsResult>(
      `/api/v1/vnc/accounts/${encodeURIComponent(id)}/novnc/start`,
      { method: 'POST', body: '{}', allowStatuses: [403, 422] },
    ),
  stopNovnc: (id: string) =>
    api.requestRawAllowStatus<VncOpsResult>(
      `/api/v1/vnc/accounts/${encodeURIComponent(id)}/novnc/stop`,
      { method: 'POST', body: '{}', allowStatuses: [403, 422] },
    ),
  openFirewall: (id: string) =>
    api.requestRawAllowStatus<VncOpsResult>(
      `/api/v1/vnc/accounts/${encodeURIComponent(id)}/firewall`,
      { method: 'POST', body: '{}', allowStatuses: [403, 422] },
    ),
  listClientProfiles: () =>
    api.requestRaw<{ ok: boolean; items: VncClientProfile[] }>(
      '/api/v1/vnc/client/profiles',
    ),
  createClientProfile: (body: {
    name: string;
    host: string;
    port: number;
    path?: VncConnectPath;
    password?: string;
    autostart?: boolean;
  }) =>
    api.requestRaw<{ ok: boolean; profile: VncClientProfile }>(
      '/api/v1/vnc/client/profiles',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  clientUp: (id: string, path?: VncConnectPath) =>
    api.requestRawAllowStatus<VncOpsResult & { profile?: VncClientProfile }>(
      `/api/v1/vnc/client/profiles/${encodeURIComponent(id)}/up`,
      {
        method: 'POST',
        body: JSON.stringify(path ? { path } : {}),
        allowStatuses: [403, 422],
      },
    ),
  /** Mint browser VNC session ticket (WS RFB proxy). */
  createSession: (body: { kind: 'account' | 'client'; id: string }) =>
    api.requestRawAllowStatus<{
      ok: boolean;
      ticket?: string;
      sessionId?: string;
      wsPath?: string;
      expiresAt?: string;
      target?: {
        kind: string;
        id: string;
        label?: string;
        host?: string;
        port?: number;
      };
      password?: string;
      hasStoredPassword?: boolean;
      notes?: string[];
      blocked?: boolean;
      requiresExecute?: boolean;
      message?: string;
    }>('/api/v1/vnc/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
    }),
  clientDown: (id: string) =>
    api.requestRawAllowStatus<VncOpsResult & { profile?: VncClientProfile }>(
      `/api/v1/vnc/client/profiles/${encodeURIComponent(id)}/down`,
      { method: 'POST', body: '{}', allowStatuses: [403, 422] },
    ),
  deleteClientProfile: (id: string) =>
    api.requestRawAllowStatus<VncOpsResult>(
      `/api/v1/vnc/client/profiles/${encodeURIComponent(id)}`,
      { method: 'DELETE', body: '{}', allowStatuses: [403, 422] },
    ),
};
