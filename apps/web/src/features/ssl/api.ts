/**
 * Real SSL certificate API — disk + upsert registry, no fake "mark applied".
 */
import { api } from '../../shared/services/api';

export type CertificateView = {
  id: string;
  domain: string;
  provider: string;
  status: string;
  files_exist: boolean;
  fullchain_path?: string;
  privkey_path?: string;
  expires_at?: string | null;
  bytes?: number;
  notes?: string[];
  updated_at?: string;
  commands?: string[];
};

export const sslApi = {
  list: () => api.requestRaw<{ items: CertificateView[] }>('/api/v1/ssl/certificates'),
  bindings: () =>
    api.requestRaw<{
      items: Array<
        CertificateView & {
          projects?: Array<{ id: string; name: string; domain?: string }>;
          mailDomains?: Array<{ id: string; domain: string }>;
        }
      >;
      renewJobs?: Array<Record<string, unknown>>;
      notes?: string[];
    }>('/api/v1/ssl/bindings'),
  upload: (body: { domain: string; fullchainPem: string; privkeyPem: string }) =>
    api.requestRaw<{ certificate: Record<string, unknown> }>('/api/v1/ssl/upload', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  letsencrypt: (body: { domain: string; email: string; execute?: boolean }) =>
    api.requestRaw<{
      ok: boolean;
      executed?: boolean;
      blocked?: boolean;
      blockMessage?: string;
      notes: string[];
      steps?: Array<{ name: string; status: 'ok' | 'skipped' | 'failed' | 'blocked'; detail?: string }>;
      certificate: Record<string, unknown>;
    }>('/api/v1/ssl/letsencrypt', {
      method: 'POST',
      body: JSON.stringify({ ...body, execute: body.execute !== false }),
    }),
  letsencryptViaSystem: (body: { domain: string; email: string; run?: boolean }) =>
    api.requestRaw<{
      ok: boolean;
      executed?: boolean;
      blocked?: boolean;
      blockMessage?: string;
      notes: string[];
      steps?: Array<{ name: string; status: 'ok' | 'skipped' | 'failed' | 'blocked'; detail?: string }>;
      certificate: Record<string, unknown>;
    }>('/api/v1/system/ssl/apply', {
      method: 'POST',
      body: JSON.stringify({ ...body, run: body.run !== false }),
    }),
  remove: (idOrDomain: string) =>
    api.requestRaw<{ ok: boolean; domain: string; notes: string[] }>(
      `/api/v1/ssl/certificates/${encodeURIComponent(idOrDomain)}`,
      { method: 'DELETE' },
    ),
};
