/**
 * Updates feature — inventory, self-update, scheduler API.
 */
import { api } from '../../shared/services/api';

export type AdviceRow = {
  packageName: string;
  currentVersion: string;
  candidateVersion?: string;
  advice?: string;
  risk?: string;
  summary?: string;
  cves?: string[];
  requiresApproval?: boolean;
};

export type InventoryMeta = {
  source?: string;
  upgradableCount?: number;
  notes?: string[];
};

export const updatesApi = {
  inventory: () =>
    api.requestRaw<{
      inventory: Array<{
        packageName: string;
        currentVersion: string;
        candidateVersion?: string;
      }>;
      advice: AdviceRow[];
      meta?: InventoryMeta;
      collectedAt?: string;
    }>('/api/v1/updates/inventory'),
  refresh: (osv = false) =>
    api.requestRaw<{
      inventory: Array<{
        packageName: string;
        currentVersion: string;
        candidateVersion?: string;
      }>;
      advice: AdviceRow[];
      meta?: InventoryMeta;
      collectedAt?: string;
    }>('/api/v1/updates/inventory/refresh', {
      method: 'POST',
      body: JSON.stringify({ osv, limit: 12 }),
    }),
  applyPackage: (body: {
    packageName: string;
    currentVersion: string;
    candidateVersion?: string;
    risk?: string;
    cves?: string[];
    requiresApproval?: boolean;
    summary?: string;
    confirmHighRisk?: boolean;
  }) =>
    api.requestRaw<{
      ok: boolean;
      applied?: boolean;
      blocked?: boolean;
      blockMessage?: string;
      notes: string[];
    }>('/api/v1/updates/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  self: () => api.requestRaw<Record<string, unknown>>('/api/v1/updates/self'),
  selfApply: () =>
    api.requestRaw<{ ok?: boolean; notes?: string[]; applied?: boolean }>(
      '/api/v1/updates/self/apply',
      { method: 'POST', body: JSON.stringify({ apply: true }) },
    ),
  scheduler: () =>
    api.requestRaw<{ jobs: Array<Record<string, unknown>> }>('/api/v1/scheduler'),
};
