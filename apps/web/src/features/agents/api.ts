/**
 * Agents feature — fleet + runtime probe/install API.
 */
import type { FleetAgent, FleetCommand, RuntimeProbe } from '@yanshekki/shared';
import { api } from '../../shared/services/api';

export type { FleetAgentStatus, FleetAgent, FleetCommand, RuntimeProbe } from '@yanshekki/shared';

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
