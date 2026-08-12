import { tl } from '@yanshekki/shared';
/**
 * Per-project disk usage for metrics panel (real `du`, reuses quota helpers).
 */

import type { HostExecutor } from '../host/executor.js';
import { measureDirBytes } from '../hosting/quota.js';

export type ProjectDiskUsageRow = {
  projectId: string;
  name: string;
  domain?: string;
  homeDir: string;
  usedBytes: number;
  usedMb: number;
  quotaMb: number | null;
  /** used/quota ratio when quota set; else null */
  usedRatio: number | null;
  withinQuota: boolean | null;
  notes: string[];
};

export type ProjectsDiskUsageSnapshot = {
  ok: boolean;
  at: string;
  items: ProjectDiskUsageRow[];
  totalUsedBytes: number;
  notes: string[];
};

export type ProjectUsageInput = {
  id: string;
  name: string;
  domain?: string;
  home_dir?: string;
  homeDir?: string;
  quota_mb?: number | null;
  quotaMb?: number | null;
};

/**
 * Measure each project home with real `du`. Caps concurrency to avoid load spikes.
 */
export async function collectProjectsDiskUsage(input: {
  host: HostExecutor;
  projects: ProjectUsageInput[];
  /** Max concurrent du (default 3) */
  concurrency?: number;
  /** Soft cap on projects measured (default 50) */
  limit?: number;
}): Promise<ProjectsDiskUsageSnapshot> {
  const notes: string[] = [];
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const concurrency = Math.min(Math.max(input.concurrency ?? 3, 1), 8);
  const slice = input.projects.slice(0, limit);
  if (input.projects.length > limit) {
    notes.push(tl('notes.auto.t0459', { v0: (limit), v1: (input.projects.length) }));
  }

  const items: ProjectDiskUsageRow[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < slice.length) {
      const i = cursor++;
      const p = slice[i]!;
      const homeDir = String(p.home_dir ?? p.homeDir ?? '').trim();
      const quotaRaw = p.quota_mb ?? p.quotaMb;
      const quotaMb =
        quotaRaw != null && Number.isFinite(Number(quotaRaw)) && Number(quotaRaw) > 0
          ? Number(quotaRaw)
          : null;

      if (!homeDir) {
        items.push({
          projectId: p.id,
          name: p.name || p.id,
          domain: p.domain,
          homeDir: '',
          usedBytes: 0,
          usedMb: 0,
          quotaMb,
          usedRatio: null,
          withinQuota: null,
          notes: [tl('notes.auto.n1078')],
        });
        continue;
      }

      const { bytes, notes: n } = await measureDirBytes(input.host, homeDir);
      const usedMb = Math.round((bytes / (1024 * 1024)) * 100) / 100;
      let withinQuota: boolean | null = null;
      let usedRatio: number | null = null;
      if (quotaMb != null && quotaMb > 0) {
        withinQuota = usedMb <= quotaMb;
        usedRatio = usedMb / quotaMb;
      }
      items.push({
        projectId: p.id,
        name: p.name || p.id,
        domain: p.domain,
        homeDir,
        usedBytes: bytes,
        usedMb,
        quotaMb,
        usedRatio,
        withinQuota,
        notes: n,
      });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, slice.length || 1) }, () =>
    worker(),
  );
  await Promise.all(workers);

  // Stable order by used desc
  items.sort((a, b) => b.usedBytes - a.usedBytes);
  const totalUsedBytes = items.reduce((s, r) => s + r.usedBytes, 0);

  return {
    ok: true,
    at: new Date().toISOString(),
    items,
    totalUsedBytes,
    notes,
  };
}
