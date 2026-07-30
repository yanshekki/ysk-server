/**
 * Host network interfaces / routes / DNS.
 */
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';

export type NetAddress = {
  family: 'inet' | 'inet6';
  local: string;
  prefixlen: number;
  scope?: string;
  label?: string;
  dynamic?: boolean;
};

export type NetInterface = {
  name: string;
  ifindex: number;
  mac?: string;
  mtu?: number;
  operstate: string;
  flags: string[];
  linkType?: string;
  addrs: NetAddress[];
  stats?: {
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
  };
  isLoopback: boolean;
  isDefaultEgress?: boolean;
};

export type NetRoute = {
  dst: string;
  gateway?: string;
  dev?: string;
  protocol?: string;
  metric?: number;
  scope?: string;
  prefsrc?: string;
};

export type NetworkSnapshot = {
  ok: boolean;
  at: string;
  interfaces: NetInterface[];
  routes: NetRoute[];
  dns: {
    nameservers: string[];
    search: string[];
    source: string;
    notes: string[];
    mode?: 'networkmanager' | 'resolved' | 'static' | 'unknown';
    canApply?: boolean;
    connection?: string;
    device?: string;
    stubServers?: string[];
    uplinkServers?: string[];
    ignoreAutoDns?: boolean | null;
    gatewayDns?: string;
  };
  backend: {
    hasIp: boolean;
    networkManager: string;
    networkd: string;
    canPersist: boolean;
  };
  caps: {
    executeEnabled: boolean;
    isRoot: boolean;
    canMutate: boolean;
  };
  defaultGateway?: string;
  defaultDev?: string;
  notes: string[];
  raw?: { addr?: string; route?: string };
};

export type NetApplyResult = {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  executeEnabled?: boolean;
  isRoot?: boolean;
  ephemeral?: boolean;
  persistent?: boolean;
  interface?: string;
};

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

export const networkApi = {
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
