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

export const nginxHostingApi = {
  listSites: (params?: { q?: string; source?: string; projectId?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.source) sp.set('source', params.source);
    if (params?.projectId) sp.set('projectId', params.projectId);
    const qs = sp.toString();
    return api.requestRaw<{ items: NginxSiteRow[]; total: number }>(
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
};
