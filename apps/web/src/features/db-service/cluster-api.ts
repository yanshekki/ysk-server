/**
 * DB HA cluster API (plan-first).
 */
import { api } from '../../shared/services/api';
import type { DbServiceEngine } from './api';

export type DbClusterKind =
  | 'mariadb-galera'
  | 'mysql-replica'
  | 'postgres-replica'
  | 'redis-replica'
  | 'redis-sentinel';

export type DbClusterMember = {
  id: string;
  role: string;
  host: string;
  port: number;
  label?: string;
  access: 'local' | 'ssh' | 'fleet';
  applyStatus: string;
};

export type DbCluster = {
  id: string;
  name: string;
  engine: DbServiceEngine;
  kind: DbClusterKind;
  status: string;
  members: DbClusterMember[];
  params: Record<string, string | number | boolean>;
  artifactDir?: string;
  notes: string[];
  createdAt: string;
  updatedAt: string;
};

export type ClusterPlan = {
  ok: boolean;
  dryRun: boolean;
  clusterId: string;
  kind: string;
  engine: string;
  steps: Array<{
    id: string;
    title: string;
    kind: string;
    body?: string;
    argv?: string[];
    risk: string;
    memberId?: string;
  }>;
  files: Array<{ relativePath: string; body: string }>;
  notes: string[];
  requiresExecute: boolean;
  requiresRoot: boolean;
};

export const dbClusterApi = {
  list: (engine?: DbServiceEngine) =>
    api.requestRaw<{ ok: boolean; items: DbCluster[] }>(
      `/api/v1/db/clusters${engine ? `?engine=${engine}` : ''}`,
    ),
  get: (id: string) =>
    api.requestRaw<{ ok: boolean; cluster: DbCluster }>(`/api/v1/db/clusters/${id}`),
  create: (body: {
    name: string;
    engine: DbServiceEngine;
    kind: DbClusterKind;
    members: Array<{
      host: string;
      role?: string;
      port?: number;
      access?: 'local' | 'ssh' | 'fleet';
      label?: string;
    }>;
    params?: Record<string, string | number | boolean>;
  }) =>
    api.requestRaw<{ ok: boolean; cluster: DbCluster }>('/api/v1/db/clusters', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    api.requestRaw<{ ok: boolean; notes?: string[] }>(`/api/v1/db/clusters/${id}`, {
      method: 'DELETE',
    }),
  plan: (id: string) =>
    api.requestRaw<{ ok: boolean; cluster: DbCluster; plan: ClusterPlan }>(
      `/api/v1/db/clusters/${id}/plan`,
      { method: 'POST', body: '{}' },
    ),
  apply: (id: string, body?: { execute?: boolean; bootstrap?: boolean }) =>
    api.requestRaw<{
      ok: boolean;
      dryRun: boolean;
      executed: boolean;
      blocked?: boolean;
      cluster: DbCluster;
      written: string[];
      notes: string[];
      requiresExecute: boolean;
      requiresRoot: boolean;
      systemConf?: string;
    }>(`/api/v1/db/clusters/${id}/apply`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  probe: (id: string) =>
    api.requestRaw<{
      ok: boolean;
      localOk: boolean;
      cluster: DbCluster;
      facts: Record<string, string>;
      notes: string[];
    }>(`/api/v1/db/clusters/${id}/probe`, { method: 'POST', body: '{}' }),
};
