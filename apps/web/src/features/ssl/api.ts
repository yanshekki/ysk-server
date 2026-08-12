/**
 * Real SSL certificate API — disk + upsert registry, no fake "mark applied".
 */
import type { CertificateView } from '@yanshekki/shared';
import { api } from '../../shared/services/api';

export type { CertificateView } from '@yanshekki/shared';

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
      renewal?: {
        autoRenew: boolean;
        source: string;
        unitFound: boolean;
        enabled?: boolean;
        active?: boolean;
        unitName?: string;
        cronJobCount: number;
        notes: string[];
      };
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
