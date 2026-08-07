/**
 * Host network interfaces / routes / DNS.
 */
import type { NetApplyResult, NetworkSnapshot } from '@ysk/shared';
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';

export type {
  NetAddress,
  NetInterface,
  NetRoute,
  NetworkSnapshot,
  NetApplyResult,
} from '@ysk/shared';

async function opsPost(
  path: string,
  body: unknown,
  method: 'POST' | 'DELETE' | 'PUT' = 'POST',
): Promise<NetApplyResult> {
  const token = authStore.getToken();
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let data: NetApplyResult = { ok: false, notes: [] };
  try {
    data = (await res.json()) as NetApplyResult;
  } catch {
    /* */
  }
  return {
    ...data,
    notes: Array.isArray(data.notes) ? data.notes : [],
    ok: Boolean(data.ok),
  };
}

export type RealIpConfigDto = {
  defaultProvider: string;
  trustMode: 'single_provider' | 'xff_merged';
  enabledProviders: string[];
  customCidrs: string[];
  customHeader?: string;
  lastRefreshAt?: string;
};

export type RealIpCatalogItem = {
  id: string;
  label: string;
  clientIpHeader: string;
  hasSources?: boolean;
  snapshotCount?: number;
};

export type RealIpStatusDto = {
  config: RealIpConfigDto;
  providers: Array<{
    id: string;
    label: string;
    clientIpHeader: string;
    snapshotCount: number;
  }>;
  catalog: RealIpCatalogItem[];
};

export const networkApi = {
  realIpStatus: () => api.requestRaw<RealIpStatusDto>('/api/v1/system/real-ip'),
  patchRealIp: (body: Partial<RealIpConfigDto> & { enableApacheRemoteIp?: boolean }) =>
    api.requestRaw<{
      ok: boolean;
      config: RealIpConfigDto;
      notes?: string[];
      written?: string[];
    }>('/api/v1/system/real-ip', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  refreshRealIp: () =>
    api.requestRaw<{
      ok: boolean;
      config: RealIpConfigDto;
      updated?: string[];
      notes?: string[];
    }>('/api/v1/system/real-ip/refresh', {
      method: 'POST',
      body: '{}',
    }),

  snapshot: (opts?: { raw?: boolean }) =>
    api.requestRaw<NetworkSnapshot>(
      `/api/v1/network${opts?.raw ? '?raw=1' : ''}`,
    ),
  addAddr: (ifname: string, body: { cidr: string; persistent?: boolean }) =>
    opsPost(
      `/api/v1/network/interfaces/${encodeURIComponent(ifname)}/addr`,
      body,
    ),
  delAddr: (ifname: string, body: { cidr: string; persistent?: boolean }) =>
    opsPost(
      `/api/v1/network/interfaces/${encodeURIComponent(ifname)}/addr`,
      body,
      'DELETE',
    ),
  setLink: (
    ifname: string,
    body: { action?: 'up' | 'down'; mtu?: number; confirmName?: string },
  ) =>
    opsPost(
      `/api/v1/network/interfaces/${encodeURIComponent(ifname)}/link`,
      body,
    ),
  addRoute: (body: {
    dst: string;
    gateway?: string;
    dev?: string;
    confirmDefault?: boolean;
    /** NetworkManager profile — survives reboot */
    persistent?: boolean;
  }) => opsPost('/api/v1/network/routes', body),
  delRoute: (body: {
    dst: string;
    gateway?: string;
    dev?: string;
    confirmDefault?: boolean;
    persistent?: boolean;
  }) => opsPost('/api/v1/network/routes', body, 'DELETE'),
  setDns: (body: {
    nameservers?: string[];
    search?: string[];
    connection?: string;
    device?: string;
    mode?: 'static' | 'dhcp';
  }) => opsPost('/api/v1/network/dns', body, 'PUT'),
  testDns: (body?: { name?: string }) =>
    opsPost('/api/v1/network/dns/test', body ?? { name: 'example.com' }),
};
