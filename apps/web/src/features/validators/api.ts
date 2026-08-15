/**
 * Validators (L1 nodes) API client — read surfaces.
 */
import type {
  ValidatorChainSpec,
  ValidatorDiskInstance,
  ValidatorDiskReport,
  ValidatorInstanceDto,
} from 'ysk-server-shared';
import { api } from '../../shared/services/api';

export type ValidatorsListResponse = {
  ok: boolean;
  instances: ValidatorInstanceDto[];
  executeEnabled?: boolean;
  isRoot?: boolean;
};

export type ValidatorChainsResponse = {
  ok: boolean;
  chains: ValidatorChainSpec[];
};

export type ValidatorDiskResponse = {
  ok: boolean;
  disk: ValidatorDiskReport;
};

export type ValidatorGetResponse = {
  ok: boolean;
  instance: ValidatorInstanceDto;
};

export const validatorsApi = {
  list: () => api.requestRaw<ValidatorsListResponse>('/api/v1/validators'),
  chains: () => api.requestRaw<ValidatorChainsResponse>('/api/v1/validators/chains'),
  disk: () => api.requestRaw<ValidatorDiskResponse>('/api/v1/validators/disk'),
  get: (id: string) =>
    api.requestRaw<ValidatorGetResponse>(`/api/v1/validators/${encodeURIComponent(id)}`),
  create: (body: {
    chain: string;
    network: string;
    profile: string;
    slug?: string;
    el?: string;
    cl?: string;
    mithril?: boolean;
    execute?: boolean;
  }) =>
    api.requestRaw<ValidatorOpsResponse>('/api/v1/validators', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  start: (id: string, execute = true) => postAction(id, 'start', { execute }),
  stop: (id: string, execute = true) => postAction(id, 'stop', { execute }),
  restart: (id: string, execute = true) => postAction(id, 'restart', { execute }),
  clear: (id: string, confirm: string, execute = true) =>
    postAction(id, 'clear', { confirm, execute }),
  status: (id: string) =>
    api.requestRaw<ValidatorStatusResponse>(
      `/api/v1/validators/${encodeURIComponent(id)}/status`,
    ),
  logs: (id: string, tail = 200) =>
    api.requestRaw<{ ok: boolean; lines: string[]; notes: string[] }>(
      `/api/v1/validators/${encodeURIComponent(id)}/logs?tail=${tail}`,
    ),
  policy: (id: string, upgrade: string) =>
    api.requestRaw<{ ok: boolean; notes?: string[] }>(
      `/api/v1/validators/${encodeURIComponent(id)}/policy`,
      { method: 'PATCH', body: JSON.stringify({ upgrade }) },
    ),
  upgrade: (id: string, execute = true) => postAction(id, 'update', { execute }),
  mithril: (id: string, confirm: string, execute = true) =>
    postAction(id, 'mithril', { confirm, execute }),
};

export type ValidatorStatusResponse = {
  ok: boolean;
  status?: string;
  running?: boolean;
  syncProgress?: number | null;
  peers?: number | null;
  version?: string | null;
  lastError?: string | null;
  upgrade?: { clientId: string; currentTag: string; nextTag: string; breaking: boolean } | null;
};

export type ValidatorOpsResponse = {
  ok: boolean;
  apply_status?: string;
  blocked?: boolean;
  instanceId?: string;
  notes?: string[];
  blockMessage?: string;
};

function postAction(id: string, action: string, body: Record<string, unknown>) {
  return api.requestRaw<ValidatorOpsResponse>(
    `/api/v1/validators/${encodeURIComponent(id)}/${action}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export type {
  ValidatorChainSpec,
  ValidatorDiskInstance,
  ValidatorDiskReport,
  ValidatorInstanceDto,
};
