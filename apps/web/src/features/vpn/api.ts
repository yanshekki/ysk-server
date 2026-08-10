/**
 * VPN server + client API client.
 */
import { api } from '../../shared/services/api';

export type VpnEngineId = 'wireguard' | 'openvpn' | 'outline';

export type VpnEngineStatus = {
  engine: VpnEngineId;
  title: string;
  installed: boolean;
  serverActive: boolean;
  serverPort: number | null;
  serverProto: string | null;
  peerCount: number;
  clientProfileCount: number;
  clientConnectedCount: number;
  notes: string[];
  missingBins: string[];
};

export type VpnServerPeer = {
  id: string;
  name: string;
  engine: VpnEngineId;
  address: string;
  publicKey: string;
  createdAt: string;
};

export type VpnClientProfile = {
  id: string;
  name: string;
  engine: VpnEngineId;
  iface: string;
  status: 'up' | 'down' | 'unknown' | 'error';
  autostart: boolean;
  createdAt: string;
};

export type VpnPortPreset = {
  engine: VpnEngineId;
  port: number;
  proto: string;
  label: string;
  recommended?: boolean;
};

export type VpnStatusResponse = {
  ok: boolean;
  engines: VpnEngineStatus[];
  endpointHint: string | null;
  executeEnabled: boolean;
  isRoot: boolean;
  serverPeers: VpnServerPeer[];
  clientProfiles: VpnClientProfile[];
  portPresets: VpnPortPreset[];
};

export const vpnApi = {
  status: () => api.requestRaw<VpnStatusResponse>('/api/v1/vpn/status'),

  ensureServer: (body: {
    engine?: VpnEngineId;
    listenPort?: number;
    endpoint?: string;
    dns?: string;
  }) =>
    api.requestRaw<{
      ok: boolean;
      notes?: string[];
      blocked?: boolean;
      requiresExecute?: boolean;
    }>('/api/v1/vpn/server/ensure', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  addPeer: (body: { name: string; engine?: VpnEngineId }) =>
    api.requestRaw<{
      ok: boolean;
      notes?: string[];
      peer?: VpnServerPeer;
      config?: string;
      blocked?: boolean;
    }>('/api/v1/vpn/server/clients', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deletePeer: (id: string) =>
    api.requestRaw<{ ok: boolean; notes?: string[] }>(
      `/api/v1/vpn/server/clients/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),

  peerConfigPath: (id: string) =>
    `/api/v1/vpn/server/clients/${encodeURIComponent(id)}/config`,

  /** Fetch conf text for QR (authenticated). */
  peerConfigText: async (id: string): Promise<string> => {
    const { authStore } = await import('../../shared/stores/auth-store');
    const token = authStore.getToken();
    const res = await fetch(
      `/api/v1/vpn/server/clients/${encodeURIComponent(id)}/config`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) throw new Error(`config ${res.status}`);
    return res.text();
  },

  importClient: (body: {
    name: string;
    conf: string;
    engine?: VpnEngineId;
    autostart?: boolean;
  }) =>
    api.requestRaw<{
      ok: boolean;
      notes?: string[];
      profile?: VpnClientProfile;
    }>('/api/v1/vpn/client/profiles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  clientUp: (id: string) =>
    api.requestRaw<{ ok: boolean; notes?: string[]; blocked?: boolean }>(
      `/api/v1/vpn/client/profiles/${encodeURIComponent(id)}/up`,
      { method: 'POST', body: '{}' },
    ),

  clientDown: (id: string) =>
    api.requestRaw<{ ok: boolean; notes?: string[] }>(
      `/api/v1/vpn/client/profiles/${encodeURIComponent(id)}/down`,
      { method: 'POST', body: '{}' },
    ),

  deleteClient: (id: string) =>
    api.requestRaw<{ ok: boolean; notes?: string[] }>(
      `/api/v1/vpn/client/profiles/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),

  openFirewall: (body: { port: number; proto: string }) =>
    api.requestRaw<{ ok: boolean; notes?: string[]; blocked?: boolean }>(
      '/api/v1/vpn/firewall/open',
      { method: 'POST', body: JSON.stringify(body) },
    ),
};
