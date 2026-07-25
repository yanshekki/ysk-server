/**
 * Updates feature — inventory, self-update, scheduler API.
 */
import { api } from '../../shared/services/api';

export type AdviceRow = {
  packageName: string;
  currentVersion: string;
  advice?: string;
  risk?: string;
  summary?: string;
  cves?: string[];
};

export const updatesApi = {
  inventory: () =>
    api.requestRaw<{
      inventory: Array<{ packageName: string; currentVersion: string }>;
      advice: AdviceRow[];
      collectedAt?: string;
    }>('/api/v1/updates/inventory'),
  refresh: (osv = false) =>
    api.requestRaw<{
      inventory: Array<{ packageName: string; currentVersion: string }>;
      advice: AdviceRow[];
      collectedAt?: string;
    }>('/api/v1/updates/inventory/refresh', {
      method: 'POST',
      body: JSON.stringify({ osv }),
    }),
  self: () => api.requestRaw<Record<string, unknown>>('/api/v1/updates/self'),
  scheduler: () =>
    api.requestRaw<{ jobs: Array<Record<string, unknown>> }>('/api/v1/scheduler'),
};
