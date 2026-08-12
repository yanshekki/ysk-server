/**
 * Dashboard feature — summary + host metrics API.
 */
import type { HealthResponse } from '@ysk-server/shared';
import { api } from '../../shared/services/api';

export const dashboardApi = {
  health: (): Promise<HealthResponse> => api.health(),
  audit: () => api.audit(),
  metrics: () => api.requestRaw<Record<string, unknown>>('/api/v1/metrics'),
  projects: () => api.listProjects(),
  backups: () => api.requestRaw<{ items: unknown[] }>('/api/v1/backups'),
  sslBindings: () =>
    api.requestRaw<{
      items: Array<{ domain: string; expires_at?: string | null; files_exist?: boolean }>;
    }>('/api/v1/ssl/bindings'),
  summary: () => api.requestRaw<Record<string, unknown>>('/api/v1/dashboard/summary'),
  notifications: () =>
    api.requestRaw<{
      items: Array<{
        id: string;
        level: 'critical' | 'warn' | 'info';
        title: string;
        body: string;
        href?: string;
        source: string;
        at: string;
      }>;
      counts: { critical: number; warn: number; info: number };
    }>('/api/v1/notifications'),
  applyAudit: () =>
    api.requestRaw<{
      findings: Array<{
        kind: string;
        id: string;
        name: string;
        apply_status?: string;
        issue?: string;
        severity: 'ok' | 'warn' | 'bad';
        href?: string;
      }>;
      summary: { ok: number; warn: number; bad: number; total: number };
    }>('/api/v1/system/apply-audit'),
  readiness: async () => {
    // 503 when not productionReady still carries full report body — must not throw.
    // Still send Accept-Language so summary strings match the UI locale.
    return api.requestRawAllowStatus<{
      productionReady: boolean;
      mode: string;
      summary: string[];
      score: { ready: number; degraded: number; missing: number; total: number };
    }>('/api/v1/readiness', { allowStatuses: [503] });
  },
};
