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
  probe: (id: string, body?: { peers?: boolean }) =>
    api.requestRaw<{
      ok: boolean;
      localOk: boolean;
      peersProbed?: number;
      cluster: DbCluster;
      facts: Record<string, string>;
      notes: string[];
    }>(`/api/v1/db/clusters/${id}/probe`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  installPeers: (
    id: string,
    body?: { execute?: boolean; memberId?: string; restart?: boolean },
  ) =>
    api.requestRaw<{
      ok: boolean;
      dryRun: boolean;
      notes: string[];
      installed: Array<{ host: string; ok: boolean; detail: string }>;
      cluster: DbCluster;
    }>(`/api/v1/db/clusters/${id}/install-peers`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  overview: () =>
    api.requestRaw<{
      ok: boolean;
      count: number;
      items: Array<{
        id: string;
        name: string;
        engine: string;
        kind: string;
        status: string;
        members: number;
        firewallPorts: number[];
      }>;
    }>('/api/v1/db/clusters/overview'),
  patch: (
    id: string,
    body: {
      name?: string;
      params?: Record<string, string | number | boolean>;
      members?: Array<{
        host: string;
        role?: string;
        access?: string;
        fleetAgentId?: string;
        label?: string;
      }>;
    },
  ) =>
    api.requestRaw<{ ok: boolean; cluster: DbCluster }>(
      `/api/v1/db/clusters/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  artifacts: (id: string) =>
    api.requestRaw<{
      ok: boolean;
      artifactDir: string;
      files: Array<{ relativePath: string; bytes: number }>;
      notes: string[];
    }>(`/api/v1/db/clusters/${id}/artifacts`),
  bundle: (id: string) =>
    api.requestRaw<{
      ok: boolean;
      bundlePath?: string;
      bytes?: number;
      notes: string[];
    }>(`/api/v1/db/clusters/${id}/bundle`, { method: 'POST', body: '{}' }),
  /** Relative path for browser download (Bearer via cookie/session may not apply — use token query if needed) */
  bundleDownloadUrl: (id: string) => `/api/v1/db/clusters/${id}/bundle/download`,
  push: (id: string, body?: { execute?: boolean; memberId?: string }) =>
    api.requestRaw<{
      ok: boolean;
      dryRun: boolean;
      executed: boolean;
      blocked?: boolean;
      notes: string[];
      targets: Array<{
        host: string;
        role: string;
        files: string[];
        remotePath: string;
      }>;
      cluster: DbCluster;
    }>(`/api/v1/db/clusters/${id}/push`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  fleet: (
    id: string,
    body?: {
      execute?: boolean;
      memberId?: string;
      op?: 'apply' | 'probe' | 'plan' | 'sync';
      edgeExecute?: boolean;
    },
  ) =>
    api.requestRaw<{
      ok: boolean;
      dryRun: boolean;
      notes: string[];
      queued: Array<{
        host: string;
        fleetAgentId: string;
        cli: string[];
        commandId?: string;
      }>;
      cluster: DbCluster;
    }>(`/api/v1/db/clusters/${id}/fleet`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
};
