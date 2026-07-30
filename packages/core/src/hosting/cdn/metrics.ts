/**
 * CDN status dashboard + cache hit-rate estimate (PR-C5).
 * Hit-rate is honest: sample nginx access logs when available; else unknown.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ApplyStatus, CdnNodeDto, CdnSiteDto } from '@ysk/shared';
import type { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import { listCdnNodes } from './nodes.js';
import { listCdnSites } from './sites.js';
import { listCdnManagedDnsRecords } from './dns-sync.js';

export type CdnCacheEstimate = {
  siteId: string;
  siteName: string;
  method: 'access_log' | 'cache_dir' | 'none';
  hitRatePct?: number;
  hits?: number;
  misses?: number;
  bypass?: number;
  sampleLines?: number;
  cacheBytes?: number;
  notes: string[];
};

export type CdnSiteDashRow = {
  id: string;
  name: string;
  domains: string[];
  mode: string;
  strategy: string;
  apply_status: ApplyStatus;
  edgeCount: number;
  edgesApplied: number;
  edgesFailed: number;
  managedDnsRecords: number;
  onlineEdges: number;
};

export type CdnDashboard = {
  at: string;
  nodes: {
    total: number;
    online: number;
    offline: number;
    draining: number;
    unknown: number;
    byRegion: Record<string, number>;
  };
  sites: {
    total: number;
    byApplyStatus: Record<string, number>;
    rows: CdnSiteDashRow[];
  };
  cache: CdnCacheEstimate[];
  /** Aggregate hit-rate when any sample exists */
  overallHitRatePct?: number;
  notes: string[];
};

function nodeStatusBucket(
  n: CdnNodeDto,
): 'online' | 'offline' | 'draining' | 'unknown' {
  if (n.status === 'online') return 'online';
  if (n.status === 'offline') return 'offline';
  if (n.status === 'draining') return 'draining';
  return 'unknown';
}

function parseCacheStatuses(text: string): {
  hits: number;
  misses: number;
  bypass: number;
  sample: number;
} {
  // Match common upstream_cache_status tokens
  const tokens = text.match(/\b(HIT|MISS|BYPASS|EXPIRED|STALE|UPDATING|REVALIDATED)\b/g) ?? [];
  let hits = 0;
  let misses = 0;
  let bypass = 0;
  for (const t of tokens) {
    if (t === 'HIT' || t === 'STALE' || t === 'REVALIDATED') hits += 1;
    else if (t === 'MISS' || t === 'EXPIRED' || t === 'UPDATING') misses += 1;
    else bypass += 1;
  }
  return { hits, misses, bypass, sample: tokens.length };
}

function dirSizeBytes(path: string, maxFiles = 5000): number {
  if (!existsSync(path)) return 0;
  let total = 0;
  let count = 0;
  const walk = (p: string) => {
    if (count >= maxFiles) return;
    let ents: string[];
    try {
      ents = readdirSync(p);
    } catch {
      return;
    }
    for (const e of ents) {
      if (count >= maxFiles) return;
      const full = join(p, e);
      try {
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else {
          total += st.size;
          count += 1;
        }
      } catch {
        /* skip */
      }
    }
  };
  walk(path);
  return total;
}

/**
 * Estimate cache hit rate for one site (local log/cache path first).
 */
export async function estimateSiteCacheHitRate(input: {
  site: CdnSiteDto;
  host?: HostExecutor;
  dataDir: string;
  /** Optional explicit access log path */
  accessLogPath?: string;
}): Promise<CdnCacheEstimate> {
  const notes: string[] = [];
  const site = input.site;
  const logCandidates = [
    input.accessLogPath,
    '/var/log/nginx/access.log',
    '/var/log/nginx/access.log.1',
    join(input.dataDir, 'logs', 'nginx-access.log'),
  ].filter(Boolean) as string[];

  // Prefer host.runCommand tail if EXECUTE (works for remote sample later)
  if (input.host?.executeEnabled()) {
    for (const logPath of logCandidates) {
      const r = await input.host.runCommand(
        [
          'bash',
          '-c',
          `test -f ${JSON.stringify(logPath)} && tail -n 3000 ${JSON.stringify(logPath)} 2>/dev/null | grep -oE '\\b(HIT|MISS|BYPASS|EXPIRED|STALE|UPDATING|REVALIDATED)\\b' | tail -n 2000 || true`,
        ],
        { timeoutMs: 12_000 },
      );
      const parsed = parseCacheStatuses(r.stdout || '');
      if (parsed.sample > 0) {
        const denom = parsed.hits + parsed.misses;
        const hitRatePct =
          denom > 0
            ? Math.round((parsed.hits / denom) * 1000) / 10
            : undefined;
        notes.push(
          `access_log 抽樣 ${logPath}（${parsed.sample} 個 cache status token）`,
        );
        notes.push(
          '需 nginx log_format 含 $upstream_cache_status（或 X-YSK-Cache）先有 HIT/MISS',
        );
        return {
          siteId: site.id,
          siteName: site.name,
          method: 'access_log',
          hitRatePct,
          hits: parsed.hits,
          misses: parsed.misses,
          bypass: parsed.bypass,
          sampleLines: parsed.sample,
          notes,
        };
      }
    }
  } else {
    // Direct file read when path visible without execute
    for (const logPath of logCandidates) {
      if (!existsSync(logPath)) continue;
      try {
        const raw = readFileSync(logPath, 'utf8');
        const tail = raw.slice(-200_000);
        const parsed = parseCacheStatuses(tail);
        if (parsed.sample > 0) {
          const denom = parsed.hits + parsed.misses;
          notes.push(`讀取本地 log ${logPath}`);
          return {
            siteId: site.id,
            siteName: site.name,
            method: 'access_log',
            hitRatePct:
              denom > 0
                ? Math.round((parsed.hits / denom) * 1000) / 10
                : undefined,
            hits: parsed.hits,
            misses: parsed.misses,
            bypass: parsed.bypass,
            sampleLines: parsed.sample,
            notes,
          };
        }
      } catch {
        /* next */
      }
    }
  }

  // Fallback: cache directory size only
  const cachePath = `/var/cache/ysk-cdn/${site.id}`;
  const localManaged = join(input.dataDir, 'cdn', 'cache-stats', site.id);
  let cacheBytes = 0;
  if (existsSync(cachePath)) {
    cacheBytes = dirSizeBytes(cachePath);
    notes.push(`cache 目錄 ${cachePath} ≈ ${cacheBytes} bytes（非命中率）`);
  } else if (existsSync(localManaged)) {
    cacheBytes = dirSizeBytes(localManaged);
    notes.push(`managed cache-stats ${localManaged}`);
  } else {
    notes.push(
      '無 access log cache status、亦無 cache 目錄 — hit-rate 未知（請開 log_format 或先 apply edge）',
    );
    return {
      siteId: site.id,
      siteName: site.name,
      method: 'none',
      notes,
    };
  }

  return {
    siteId: site.id,
    siteName: site.name,
    method: 'cache_dir',
    cacheBytes,
    notes: [
      ...notes,
      '僅有磁碟佔用粗估，唔係 HIT 比率',
    ],
  };
}

/**
 * Build control-plane CDN dashboard snapshot.
 */
export async function collectCdnDashboard(input: {
  db: JsonStore;
  dataDir: string;
  host?: HostExecutor;
  /** Estimate cache for at most N sites (default 10) */
  maxCacheSamples?: number;
}): Promise<CdnDashboard> {
  const notes: string[] = [];
  const nodes = listCdnNodes(input.db);
  const sites = listCdnSites(input.db);

  const nodeBuckets = {
    total: nodes.length,
    online: 0,
    offline: 0,
    draining: 0,
    unknown: 0,
    byRegion: {} as Record<string, number>,
  };
  for (const n of nodes) {
    const b = nodeStatusBucket(n);
    nodeBuckets[b] += 1;
    const reg = n.region || 'default';
    nodeBuckets.byRegion[reg] = (nodeBuckets.byRegion[reg] ?? 0) + 1;
  }

  const byApplyStatus: Record<string, number> = {};
  const rows: CdnSiteDashRow[] = [];

  for (const s of sites) {
    byApplyStatus[s.apply_status] = (byApplyStatus[s.apply_status] ?? 0) + 1;
    let edgesApplied = 0;
    let edgesFailed = 0;
    let onlineEdges = 0;
    for (const eid of s.edgeNodeIds) {
      const st = s.edge_status?.[eid];
      if (st === 'applied') edgesApplied += 1;
      if (st === 'failed') edgesFailed += 1;
      const node = nodes.find((n) => n.id === eid);
      if (node && (node.status === 'online' || node.lastHealth?.ok)) {
        onlineEdges += 1;
      }
    }
    rows.push({
      id: s.id,
      name: s.name,
      domains: s.domains,
      mode: s.mode,
      strategy: s.dns?.strategy ?? 'multi_a',
      apply_status: s.apply_status,
      edgeCount: s.edgeNodeIds.length,
      edgesApplied,
      edgesFailed,
      managedDnsRecords: listCdnManagedDnsRecords(input.db, s.id).length,
      onlineEdges,
    });
  }

  const maxSamples = input.maxCacheSamples ?? 10;
  const cache: CdnCacheEstimate[] = [];
  for (const s of sites.slice(0, maxSamples)) {
    cache.push(
      await estimateSiteCacheHitRate({
        site: s,
        host: input.host,
        dataDir: input.dataDir,
      }),
    );
  }
  if (sites.length > maxSamples) {
    notes.push(
      `cache 抽樣僅前 ${maxSamples}/${sites.length} 個站點`,
    );
  }

  const withRate = cache.filter((c) => typeof c.hitRatePct === 'number');
  let overallHitRatePct: number | undefined;
  if (withRate.length) {
    const totalHits = withRate.reduce((a, c) => a + (c.hits ?? 0), 0);
    const totalMiss = withRate.reduce((a, c) => a + (c.misses ?? 0), 0);
    const d = totalHits + totalMiss;
    if (d > 0) {
      overallHitRatePct = Math.round((totalHits / d) * 1000) / 10;
    }
  } else {
    notes.push('尚無可用 HIT/MISS 抽樣 — overall hit-rate 未知');
  }

  notes.push(
    '儀表為控制面彙總；公網流量／真實 CDN 命中率需 edge access log 含 cache status',
  );

  return {
    at: new Date().toISOString(),
    nodes: nodeBuckets,
    sites: {
      total: sites.length,
      byApplyStatus,
      rows,
    },
    cache,
    overallHitRatePct,
    notes,
  };
}
