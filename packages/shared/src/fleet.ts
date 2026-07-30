/**
 * Fleet agents + runtime probe — API contract.
 */

export type FleetAgentStatus =
  | 'registered'
  | 'connected'
  | 'stale'
  | 'disconnected'
  | string;

export interface FleetAgentDto {
  id: string;
  agent_id: string;
  status: FleetAgentStatus;
  group?: string;
  last_seen_at: string;
  connected_at?: string;
  meta?: Record<string, unknown>;
}

export interface FleetCommandDto {
  id: string;
  agent_session_id: string;
  payload: unknown;
  status: 'queued' | 'acked' | 'done' | 'error' | string;
  created_at: string;
  result?: unknown;
  finished_at?: string;
}

export interface RuntimeProbeDto {
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
}

export type FleetAgent = FleetAgentDto;
export type FleetCommand = FleetCommandDto;
export type RuntimeProbe = RuntimeProbeDto;
