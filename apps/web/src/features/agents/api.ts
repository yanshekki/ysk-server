/**
 * Agents feature — fleet + runtime probe/install API.
 */
import { api } from '../../shared/services/api';

export type FleetAgentStatus = 'registered' | 'connected' | 'stale' | 'disconnected' | string;

export type FleetAgent = {
  id: string;
  agent_id: string;
  status: FleetAgentStatus;
  group?: string;
  last_seen_at: string;
  connected_at?: string;
  meta?: Record<string, unknown>;
};

export type FleetCommand = {
  id: string;
  agent_session_id: string;
  payload: unknown;
  status: 'queued' | 'acked' | 'done' | 'error' | string;
  created_at: string;
  result?: unknown;
  finished_at?: string;
};

export type RuntimeProbe = {
  kind: string;
  name: string;
  status: string;
  installPath?: string;
  pathExists?: boolean;
  unitActive?: string;
  unitName?: string;
  notes?: string[];
  installPlan?: string[];
  supervision?: string[];
  probedAt?: string;
};

export const agentsApi = {
  listFleet: () => api.requestRaw<{ items: FleetAgent[] }>('/api/v1/fleet/agents'),
  register: (body: { agentId: string; group?: string; meta?: Record<string, unknown> }) =>
    api.requestRaw<FleetAgent>('/api/v1/fleet/agents/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  remove: (sessionId: string) =>
    api.requestRaw<{ ok: boolean; id: string }>(`/api/v1/fleet/agents/${sessionId}`, {
      method: 'DELETE',
    }),
  enqueue: (sessionId: string, payload: unknown) =>
    api.requestRaw<FleetCommand>(`/api/v1/fleet/agents/${sessionId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ payload }),
    }),
  listCommands: (sessionId: string) =>
    api.requestRaw<{ items: FleetCommand[] }>(
      `/api/v1/fleet/agents/${sessionId}/commands?history=1`,
    ),
  listRuntimes: () => api.requestRaw<{ items: RuntimeProbe[] }>('/api/v1/agents/runtimes'),
  probe: (kind: string) =>
    api.requestRaw<{ runtime: RuntimeProbe }>(`/api/v1/agents/runtimes/${kind}`),
  writeUnit: (kind: string) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/agents/runtimes/${kind}/unit`, {
      method: 'POST',
      body: '{}',
    }),
  install: (kind: string, execute = true) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/agents/runtimes/${kind}/install`, {
      method: 'POST',
      body: JSON.stringify({ execute: execute !== false }),
    }),
  plan: (kind: string) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/agents/runtimes/${kind}/plan`, {
      method: 'POST',
      body: '{}',
    }),
};
