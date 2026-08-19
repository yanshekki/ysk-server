/**
 * Hosting Nginx — merged sites API.
 */
import { api } from '../../shared/services/api';

export type NginxSiteSource = 'project' | 'standalone';
export type NginxSiteKind = 'proxy' | 'static' | 'php';

export type NginxSiteRow = {
  id: string;
  source: NginxSiteSource;
  projectId?: string;
  projectName?: string;
  serverName: string;
  kind: NginxSiteKind;
  target: string;
  ssl: boolean;
  forceHttps?: boolean;
  hsts?: boolean;
  confPath?: string | null;
  apply_status?: string | null;
  runtime?: string | null;
  port?: number | null;
};

export type NginxBodySize = '1m' | '10m' | '50m' | '100m' | '500m';
export type NginxKeepalive = '15' | '65' | '120';
export type NginxAccessLog = 'off' | 'on' | 'buffered';

export type NginxGlobalSettings = {
  gzip: boolean;
  serverTokens: boolean;
  clientMaxBody: NginxBodySize;
  keepalive: NginxKeepalive;
  http2: boolean;
  accessLog: NginxAccessLog;
};

export type NginxSiteSettingsPatch = {
  ssl?: boolean;
  forceHttps?: boolean;
  hsts?: boolean;
  clientMaxBody?: NginxBodySize | 'inherit';
  cloudflareRealIp?: boolean;
  indexes?: boolean;
  websocket?: boolean;
};

export const nginxHostingApi = {
  listSites: (params?: { q?: string; source?: string; projectId?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.source) sp.set('source', params.source);
    if (params?.projectId) sp.set('projectId', params.projectId);
    const qs = sp.toString();
    return api.requestRaw<{ items: NginxSiteRow[]; total: number; allTotal?: number }>(
      `/api/v1/hosting/nginx/sites${qs ? `?${qs}` : ''}`,
    );
  },
  applySite: (id: string, body?: { ssl?: boolean }) =>
    api.requestRawAllowStatus<Record<string, unknown>>(
      `/api/v1/hosting/nginx/sites/${encodeURIComponent(id)}/apply`,
      {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
        allowStatuses: [403, 422],
      },
    ),
  siteConf: (id: string) =>
    api.requestRaw<{ path: string | null; content: string }>(
      `/api/v1/hosting/nginx/sites/${encodeURIComponent(id)}/conf`,
    ),
  getSettings: () =>
    api.requestRaw<{ settings: NginxGlobalSettings }>(
      '/api/v1/hosting/nginx/settings',
    ),
  patchSettings: (body: Partial<NginxGlobalSettings>) =>
    api.requestRaw<{ ok: boolean; settings: NginxGlobalSettings }>(
      '/api/v1/hosting/nginx/settings',
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  applySettings: (body?: Partial<NginxGlobalSettings>) =>
    api.requestRawAllowStatus<Record<string, unknown>>(
      '/api/v1/hosting/nginx/settings/apply',
      {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
        allowStatuses: [403, 422],
      },
    ),
  patchSiteSettings: (id: string, body: NginxSiteSettingsPatch) =>
    api.requestRawAllowStatus<Record<string, unknown>>(
      `/api/v1/hosting/nginx/sites/${encodeURIComponent(id)}/settings`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
        allowStatuses: [403, 422],
      },
    ),
};
