/**
 * Agents feature — fleet + runtime probe/install API.
 */
import { api } from '../../shared/services/api';

export type FleetAgent = {
  id: string;
  agent_id: string;
  status: string;
  group?: string;
  last_seen_at: string;
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
  register: (body: { agentId: string; group?: string }) =>
    api.requestRaw('/api/v1/fleet/agents/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listRuntimes: () => api.requestRaw<{ items: RuntimeProbe[] }>('/api/v1/agents/runtimes'),
  probe: (kind: string) =>
    api.requestRaw<{ runtime: RuntimeProbe }>(`/api/v1/agents/runtimes/${kind}`),
  writeUnit: (kind: string) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/agents/runtimes/${kind}/unit`, {
      method: 'POST',
      body: '{}',
    }),
  install: (kind: string, execute = false) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/agents/runtimes/${kind}/install`, {
      method: 'POST',
      body: JSON.stringify({ execute }),
    }),
  plan: (kind: string) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/agents/runtimes/${kind}/plan`, {
      method: 'POST',
      body: '{}',
    }),
};
