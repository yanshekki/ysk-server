/**
 * Redis service + key browser API
 */
import { api } from '../../shared/services/api';

export type RedisServiceStatus = {
  serverInstalled: boolean;
  clientInstalled: boolean;
  unit: string;
  active: string;
  reachable: boolean;
  ping: string | null;
  executeEnabled: boolean;
  isRoot: boolean;
  canRead: boolean;
  canWrite: boolean;
  canInstall: boolean;
  version?: string;
  usedMemory?: string;
  connectedClients?: string;
  keyspace: Array<{ db: number; keys: number; expires?: number }>;
  /** Logical DB count (indexes 0 .. databases-1) */
  databases?: number;
  configuredDatabases?: number;
  blockMessage?: string;
};

export type RedisKeyListItem = { key: string; type?: string; ttl?: number };

export type RedisKeyView = {
  key: string;
  type: string;
  ttl: number;
  value: string | Record<string, string> | string[] | Array<{ member: string; score: string }>;
};

export const redisApi = {
  status: () => api.requestRaw<RedisServiceStatus>('/api/v1/system/db/redis/status'),
  install: () =>
    api.requestRaw<Record<string, unknown>>('/api/v1/system/db/redis/install', {
      method: 'POST',
      body: '{}',
    }),
  start: () =>
    api.requestRaw<Record<string, unknown>>('/api/v1/system/db/redis/start', {
      method: 'POST',
      body: '{}',
    }),
  keys: (opts: { db?: number; pattern?: string; count?: number }) => {
    const q = new URLSearchParams();
    if (opts.db != null) q.set('db', String(opts.db));
    if (opts.pattern) q.set('pattern', opts.pattern);
    if (opts.count != null) q.set('count', String(opts.count));
    return api.requestRaw<{ ok: boolean; keys: RedisKeyListItem[]; notes?: string[] }>(
      `/api/v1/system/redis/keys?${q}`,
    );
  },
  getKey: (db: number, key: string) =>
    api.requestRaw<{ ok: boolean; view?: RedisKeyView; notes?: string[] }>(
      `/api/v1/system/redis/key?db=${db}&key=${encodeURIComponent(key)}`,
    ),
  setKey: (body: { db: number; key: string; value: string; ttl?: number }) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/system/redis/key', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  delKey: (body: { db: number; key: string }) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/system/redis/key', {
      method: 'DELETE',
      body: JSON.stringify(body),
    }),
};
