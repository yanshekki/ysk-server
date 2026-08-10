/**
 * VNC server + client API client.
 */
import { api } from '../../shared/services/api';

export type VncDesktopProfile = 'xfce' | 'minimal' | 'none';
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
  listClientProfiles: () =>
    api.requestRaw<{ ok: boolean; items: VncClientProfile[] }>(
      '/api/v1/vnc/client/profiles',
    ),
};
