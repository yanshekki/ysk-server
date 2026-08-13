/**
 * Updates feature — inventory, self-update, scheduler API.
 */
import type { AdviceRow, InventoryMeta } from 'ysk-server-shared';
import { api } from '../../shared/services/api';

export type { AdviceRow, InventoryMeta } from 'ysk-server-shared';

export type UpdateHubEntry = {
  id: string;
  title: string;
  group: 'panel' | 'service' | 'runtime' | 'os';
  kind: 'npm-panel' | 'apt' | 'runtime' | 'npm-global';
  softwareId?: string;
  packageName?: string;
  currentVersion?: string;
  latestVersion?: string;
  installed: boolean;
  upgradable: boolean;
  href: string;
  applyPath: 'apt' | 'runtime' | 'panel' | 'none';
  risk?: string;
  cves?: string[];
  requiresApproval?: boolean;
  summary?: string;
  notes: string[];
};

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
      entries?: UpdateHubEntry[];
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
      entries?: UpdateHubEntry[];
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
    api.requestRawAllowStatus<{
      ok: boolean;
      applied?: boolean;
      blocked?: boolean;
      blockMessage?: string;
      notes: string[];
    }>('/api/v1/updates/apply', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
    }),
  applyPackageStream: (
    body: {
      packageName: string;
      currentVersion: string;
      candidateVersion?: string;
      risk?: string;
      cves?: string[];
      requiresApproval?: boolean;
      summary?: string;
      confirmHighRisk?: boolean;
    },
    opts?: {
      onLog?: (line: {
        stream: 'stdout' | 'stderr' | 'status';
        line: string;
        at?: string;
      }) => void;
      signal?: AbortSignal;
    },
  ) =>
    import('../runtimes/stream-sse').then(async (m) => {
      const { ops, raw } = await m.postSseJson(
        '/api/v1/updates/apply',
        body as unknown as Record<string, unknown>,
        opts,
      );
      const r = (raw && typeof raw === 'object' ? raw : {}) as {
        applied?: boolean;
        notes?: string[];
      };
      return {
        ok: ops.ok,
        applied: Boolean(r.applied) && ops.ok,
        blocked: ops.blocked,
        blockMessage: ops.blockMessage,
        notes: ops.notes ?? r.notes ?? [],
      };
    }),
  /** Sequential bulk apply (server-side loop, max 40 packages) */
  applyBatch: (body: {
    packages: Array<{
      packageName: string;
      currentVersion: string;
      candidateVersion?: string;
      risk?: string;
      cves?: string[];
      requiresApproval?: boolean;
      summary?: string;
    }>;
    confirmHighRisk?: boolean;
  }) =>
    api.requestRawAllowStatus<{
      ok: boolean;
      appliedCount: number;
      failedCount: number;
      results: Array<{
        packageName: string;
        ok: boolean;
        applied: boolean;
        blocked?: boolean;
        blockMessage?: string;
        notes: string[];
      }>;
      notes: string[];
    }>('/api/v1/updates/apply-batch', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [207, 403, 422],
    }),
  applyBatchStream: (
    body: {
      packages: Array<{
        packageName: string;
        currentVersion: string;
        candidateVersion?: string;
        risk?: string;
        cves?: string[];
        requiresApproval?: boolean;
        summary?: string;
      }>;
      confirmHighRisk?: boolean;
    },
    opts?: {
      onLog?: (line: {
        stream: 'stdout' | 'stderr' | 'status';
        line: string;
        at?: string;
      }) => void;
      signal?: AbortSignal;
    },
  ) =>
    import('../runtimes/stream-sse').then(async (m) => {
      const { ops, raw } = await m.postSseJson(
        '/api/v1/updates/apply-batch',
        body as unknown as Record<string, unknown>,
        opts,
      );
      const r = (raw && typeof raw === 'object' ? raw : {}) as {
        ok?: boolean;
        appliedCount?: number;
        failedCount?: number;
        results?: Array<{
          packageName: string;
          ok: boolean;
          applied: boolean;
          blocked?: boolean;
          blockMessage?: string;
          notes: string[];
        }>;
        notes?: string[];
      };
      return {
        ok: r.ok !== false && ops.ok,
        appliedCount: Number(r.appliedCount ?? 0),
        failedCount: Number(r.failedCount ?? 0),
        results: r.results ?? [],
        notes: r.notes ?? ops.notes ?? [],
      };
    }),
  self: () => api.requestRaw<Record<string, unknown>>('/api/v1/updates/self'),
  selfApply: () =>
    api.requestRawAllowStatus<{
      ok?: boolean;
      notes?: string[];
      applied?: boolean;
      blockMessage?: string;
      message?: string;
    }>('/api/v1/updates/self/apply', {
      method: 'POST',
      body: JSON.stringify({ apply: true }),
      allowStatuses: [422, 502],
    }),
  scheduler: () =>
    api.requestRaw<{ jobs: Array<Record<string, unknown>> }>('/api/v1/scheduler'),
  /** Lightweight badge + overview snapshot (cached). */
  summary: () =>
    api.requestRaw<{
      ok?: boolean;
      lastScanAt?: string | null;
      nextScanAt?: string | null;
      autoScanEnabled?: boolean;
      intervalMs?: number;
      packagesUpgradable?: number;
      packagesHighRisk?: number;
      panelUpdateAvailable?: boolean;
      panelCurrent?: string;
      panelLatest?: string;
      badgeCount?: number;
      stale?: boolean;
    }>('/api/v1/updates/summary'),
  scanSettings: () =>
    api.requestRaw<{
      ok?: boolean;
      settings: { enabled: boolean; intervalMs: number };
      job?: {
        id: string;
        intervalMs: number;
        lastRunAt?: string | null;
        nextRunAt?: string | null;
        running?: boolean;
      } | null;
    }>('/api/v1/updates/scan-settings'),
  patchScanSettings: (body: { enabled?: boolean; intervalMs?: number }) =>
    api.requestRaw<{ ok: boolean; settings: { enabled: boolean; intervalMs: number } }>(
      '/api/v1/updates/scan-settings',
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
};
