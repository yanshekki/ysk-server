/**
 * Updates feature — inventory, self-update, scheduler API.
 */
import type { AdviceRow, InventoryMeta } from '@ysk/shared';
import { api } from '../../shared/services/api';

export type { AdviceRow, InventoryMeta } from '@ysk/shared';

export const updatesApi = {
  inventory: (query?: {
    q?: string;
    risk?: string;
    upgradable?: string;
    approval?: string;
    cached?: boolean;
  }) => {
    const sp = new URLSearchParams();
    if (query?.q) sp.set('q', query.q);
    if (query?.risk) sp.set('risk', query.risk);
    if (query?.upgradable) sp.set('upgradable', query.upgradable);
    if (query?.approval) sp.set('approval', query.approval);
    if (query?.cached) sp.set('cached', '1');
    const qs = sp.toString();
    return api.requestRaw<{
      inventory: Array<{
        packageName: string;
        currentVersion: string;
        candidateVersion?: string;
        risk?: string;
        needsApproval?: boolean;
        name?: string;
        version?: string;
      }>;
      advice: AdviceRow[];
      meta?: InventoryMeta;
      listMeta?: { total?: number; facets?: Record<string, Record<string, number>> };
      collectedAt?: string;
    }>(`/api/v1/updates/inventory${qs ? `?${qs}` : ''}`);
  },
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
