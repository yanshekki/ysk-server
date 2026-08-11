/**
 * Apache hosting API client.
 */
import { api } from '../../shared/services/api';

export type ApacheSiteKind = 'proxy' | 'static' | 'php';
export type ApacheBodySize = '1m' | '10m' | '50m' | '100m' | '500m';
export type ApacheSiteSource = 'project' | 'standalone' | 'artifact';

export type ApacheSite = {
  id: string;
  source?: ApacheSiteSource;
  projectId?: string;
  projectName?: string;
  serverName: string;
  kind: ApacheSiteKind;
  upstream?: string;
  root?: string;
  target?: string;
  ssl?: boolean;
  forceHttps?: boolean;
  hsts?: boolean;
  clientMaxBody?: ApacheBodySize | 'inherit';
  indexes?: boolean;
  confPath?: string | null;
  apply_status?: string | null;
  linuxUser?: string | null;
  phpVersion?: string | null;
  owned?: boolean;
  conflict?: boolean;
  conflictPeers?: string[];
};

export type ApacheGlobalSettings = {
  gzip: boolean;
  serverTokens: boolean;
  clientMaxBody: ApacheBodySize;
  keepalive: '15' | '65' | '120';
  http2: boolean;
  accessLog: 'off' | 'on';
};

export const apacheApi = {
  listSites: (params?: { q?: string; source?: string; projectId?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.source) sp.set('source', params.source);
    if (params?.projectId) sp.set('projectId', params.projectId);
    const qs = sp.toString();
    return api.requestRaw<{ items: ApacheSite[]; total?: number }>(
      `/api/v1/hosting/apache/sites${qs ? `?${qs}` : ''}`,
    );
  },
  createSite: (body: {
    serverName: string;
    kind?: ApacheSiteKind;
    upstream?: string;
    root?: string;
    ssl?: boolean;
  }) =>
    api.requestRaw<{ item: ApacheSite }>('/api/v1/hosting/apache/sites', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSite: (id: string, body: Partial<ApacheSite>) =>
    api.requestRaw<{ item: ApacheSite }>(
      `/api/v1/hosting/apache/sites/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  deleteSite: (id: string) =>
    api.requestRaw<{ ok: boolean }>(
      `/api/v1/hosting/apache/sites/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  applySite: (id: string) =>
    api.requestRawAllowStatus<Record<string, unknown>>(
      `/api/v1/hosting/apache/sites/${encodeURIComponent(id)}/apply`,
      { method: 'POST', body: '{}', allowStatuses: [403, 422] },
    ),
  getConf: (id: string) =>
    api.requestRaw<{ path: string | null; content: string }>(
      `/api/v1/hosting/apache/sites/${encodeURIComponent(id)}/conf`,
    ),
  patchSiteSettings: (id: string, body: Partial<ApacheSite>) =>
    api.requestRawAllowStatus<Record<string, unknown>>(
      `/api/v1/hosting/apache/sites/${encodeURIComponent(id)}/settings`,
      { method: 'PATCH', body: JSON.stringify(body), allowStatuses: [403, 422] },
    ),
  getSettings: () =>
    api.requestRaw<{ settings: ApacheGlobalSettings }>(
      '/api/v1/hosting/apache/settings',
    ),
  patchSettings: (body: Partial<ApacheGlobalSettings>) =>
    api.requestRaw<{ ok: boolean; settings: ApacheGlobalSettings }>(
      '/api/v1/hosting/apache/settings',
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  applySettings: (body?: Partial<ApacheGlobalSettings>) =>
    api.requestRawAllowStatus<Record<string, unknown>>(
      '/api/v1/hosting/apache/settings/apply',
      {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
        allowStatuses: [403, 422],
      },
    ),
  /** Remove unclaimed disk conf (artifact:*). */
  removeArtifact: (id: string) =>
    api.requestRawAllowStatus<Record<string, unknown>>(
      `/api/v1/hosting/apache/sites/${encodeURIComponent(id)}`,
      { method: 'DELETE', allowStatuses: [403, 404, 409, 422] },
    ),
  cleanupConflicts: () =>
    api.requestRawAllowStatus<Record<string, unknown>>(
      '/api/v1/hosting/apache/sites/cleanup-conflicts',
      { method: 'POST', body: '{}', allowStatuses: [403, 422] },
    ),
};
