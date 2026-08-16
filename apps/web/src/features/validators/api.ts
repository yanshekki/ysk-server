/**
 * Validators (L1 nodes) API client — read surfaces.
 */
import type {
  ValidatorChainSpec,
  ValidatorDiskInstance,
  ValidatorDiskReport,
  ValidatorInstanceDto,
  ValidatorSettingsDto,
  ValidatorSummaryDto,
} from 'ysk-server-shared';
import { api } from '../../shared/services/api';
import { postSseJson } from '../runtimes/stream-sse';
import type { InstallLogLine } from '../runtimes/stream-runtime-install';

export type ValidatorsListResponse = {
  ok: boolean;
  instances: ValidatorInstanceDto[];
  summaries?: ValidatorSummaryDto[];
  settings?: ValidatorSettingsDto;
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
    memory?: string;
    cpus?: string;
    dataPath?: string;
    rpcPort?: number;
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
  prune: (id: string, execute = true) => postAction(id, 'prune', { execute }),
  snapshot: (id: string, confirm: string, execute = true) =>
    postAction(id, 'snapshot', { confirm, execute }),
  switchNetwork: (id: string, network: string, confirm: string, execute = true) =>
    postAction(id, 'switch-network', { network, confirm, execute }),
  remove: (id: string, confirm: string, execute = true) =>
    postAction(id, 'delete', { confirm, execute }),
  clearFull: (
    id: string,
    confirm: string,
    opts?: { removeUnit?: boolean; restoreSnapshot?: boolean; execute?: boolean },
  ) =>
    postAction(id, 'clear', {
      confirm,
      execute: opts?.execute !== false,
      removeUnit: opts?.removeUnit,
      restoreSnapshot: opts?.restoreSnapshot,
    }),
  compose: (id: string) =>
    api.requestRaw<{ ok: boolean; path: string; content: string; notes: string[] }>(
      `/api/v1/validators/${encodeURIComponent(id)}/compose`,
    ),
  saveCompose: (id: string, content: string, execute = true) =>
    api.requestRaw<ValidatorOpsResponse>(`/api/v1/validators/${encodeURIComponent(id)}/compose`, {
      method: 'PUT',
      body: JSON.stringify({ content, execute }),
    }),
  stats: (id: string) =>
    api.requestRaw<{ ok: boolean; items: Record<string, string>[]; notes: string[] }>(
      `/api/v1/validators/${encodeURIComponent(id)}/stats`,
    ),
  checklist: (id: string) =>
    api.requestRaw<{
      ok: boolean;
      items: string[];
      links: Array<{ label: string; href: string }>;
      snapshot?: { kind: string; notes: string[] };
    }>(`/api/v1/validators/${encodeURIComponent(id)}/checklist`),
  saveSettings: (autoClear: boolean) =>
    api.requestRaw<{ ok: boolean; settings: ValidatorSettingsDto }>('/api/v1/validators/settings', {
      method: 'PATCH',
      body: JSON.stringify({ autoClear }),
    }),
};

export type ValidatorStatusResponse = {
  ok: boolean;
  status?: string;
  running?: boolean;
  syncProgress?: number | null;
  peers?: number | null;
  version?: string | null;
  lastError?: string | null;
  upgrade?: {
    clientId: string;
    currentTag: string;
    nextTag: string;
    breaking: boolean;
    changelogUrl?: string;
  } | null;
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

export function streamValidatorAction(
  id: string,
  action: string,
  body: Record<string, unknown>,
  opts?: { onLog?: (line: InstallLogLine) => void; signal?: AbortSignal },
) {
  return postSseJson(`/api/v1/validators/${encodeURIComponent(id)}/${action}`, body, opts);
}

export type {
  ValidatorChainSpec,
  ValidatorDiskInstance,
  ValidatorDiskReport,
  ValidatorInstanceDto,
};
