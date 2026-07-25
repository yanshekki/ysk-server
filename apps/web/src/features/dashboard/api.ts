/**
 * Dashboard feature — summary + host metrics API.
 */
import type { HealthResponse } from '@ysk/shared';
import { api } from '../../shared/services/api';

export const dashboardApi = {
  health: (): Promise<HealthResponse> => api.health(),
  audit: () => api.audit(),
  metrics: () => api.requestRaw<Record<string, unknown>>('/api/v1/metrics'),
  projects: () => api.listProjects(),
  backups: () => api.requestRaw<{ items: unknown[] }>('/api/v1/backups'),
  summary: () => api.requestRaw<Record<string, unknown>>('/api/v1/dashboard/summary'),
};
