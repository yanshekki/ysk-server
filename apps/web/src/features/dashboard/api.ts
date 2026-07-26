/**
 * Dashboard feature — summary + host metrics API.
 */
import type { HealthResponse } from '@ysk/shared';
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';

export const dashboardApi = {
  health: (): Promise<HealthResponse> => api.health(),
  audit: () => api.audit(),
  metrics: () => api.requestRaw<Record<string, unknown>>('/api/v1/metrics'),
  projects: () => api.listProjects(),
  backups: () => api.requestRaw<{ items: unknown[] }>('/api/v1/backups'),
  summary: () => api.requestRaw<Record<string, unknown>>('/api/v1/dashboard/summary'),
  readiness: async () => {
    // 503 when not productionReady still carries full report body
    const t = authStore.getToken();
    const res = await fetch('/api/v1/readiness', {
      headers: {
        'Content-Type': 'application/json',
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
    });
    return (await res.json()) as {
      productionReady: boolean;
      mode: string;
      summary: string[];
      score: { ready: number; degraded: number; missing: number; total: number };
    };
  },
};
