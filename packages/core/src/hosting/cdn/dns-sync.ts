/**
 * CDN ↔ DNS multi-A / failover sync (PR-C4).
 * Only mutates dns_records with managedBy=cdn for this site.
 * Honesty: DNS written ≠ public resolver propagation.
 */

import {
  ErrorCodes,
  YskError,
  type ApplyStatus,
  type CdnDnsStrategy,
  type CdnNodeDto,
  type CdnSiteDto,
} from '@ysk/shared';
import type { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import {
  createResource,
  deleteResource,
  getResource,
  listResources,
  applyDnsZone,
} from '../managed-resources.js';
import { getCdnNode, probeCdnNode } from './nodes.js';
import { getCdnSite } from './sites.js';

export type CdnHealthyEdge = {
  node: CdnNodeDto;
  healthy: boolean;
  ipv4: string[];
  ipv6: string[];
  notes: string[];
};

export type CdnDnsSyncResult = {
  ok: boolean;
  apply_status: ApplyStatus;
  siteId: string;
  strategy: CdnDnsStrategy;
  selectedNodeIds: string[];
  selectedIpv4: string[];
  selectedIpv6: string[];
  recordsTouched: number;
  zoneId?: string;
  zoneApplied?: boolean;
  notes: string[];
  edges: CdnHealthyEdge[];
  blocked?: boolean;
  requiresExecute?: boolean;
};

function isNodeHealthy(node: CdnNodeDto): boolean {
  if (node.status === 'draining') return false;
  if (node.status === 'online') return true;
  if (node.lastHealth?.ok === true && node.status !== 'offline') return true;
  return false;
}

/**
 * Pick edge IPs by strategy + minHealthyEdges guard.
 */
export function planCdnDnsTargets(input: {
  site: CdnSiteDto;
  edges: CdnHealthyEdge[];
}): {
  selected: CdnHealthyEdge[];
  strategy: CdnDnsStrategy;
  notes: string[];
  guarded: boolean;
} {
  const strategy = input.site.dns.strategy || 'multi_a';
  const minH = Math.max(1, input.site.dns.minHealthyEdges || 1);
  const notes: string[] = [];
  const healthy = input.edges.filter((e) => e.healthy);
  const allWithIp = input.edges.filter(
    (e) => e.ipv4.length > 0 || e.ipv6.length > 0,
  );

  let selected: CdnHealthyEdge[] = [];
  let guarded = false;

  if (strategy === 'failover' || strategy === 'single') {
    // Prefer first healthy by weight desc then order
    const ordered = [...healthy].sort(
      (a, b) => (b.node.weight || 0) - (a.node.weight || 0),
    );
    if (ordered.length) {
      selected = strategy === 'single' ? [ordered[0]] : ordered.slice(0, 1);
      // failover: only one live IP set
      selected = [ordered[0]];
    }
  } else if (strategy === 'weighted') {
    // Expand by weight buckets (simple repeat count for multi-A visual weight)
    const ordered = [...healthy].sort(
      (a, b) => (b.node.weight || 0) - (a.node.weight || 0),
    );
    selected = ordered;
    notes.push(
      'weighted：全部健康 edge 寫入 multi-A；權重供日後 EDNS/Geo 擴展（現為等權 A 集合）',
    );
  } else if (strategy === 'geo') {
    selected = healthy;
    notes.push(
      'geo：MVP 等同 multi_a（全部健康 edge）；geoMap 分區待 PR-C7',
    );
  } else {
    // multi_a default
    selected = healthy;
  }

  if (selected.length < minH) {
    // Guard: do not leave zone empty — fall back to all edges with IPs (or previous healthy attempt)
    guarded = true;
    notes.push(
      `minHealthyEdges=${minH} 但僅 ${selected.length} 個健康 edge — 防全滅：改用全部有 IP 的 edge（含 offline）`,
    );
    selected = allWithIp.length ? allWithIp : input.edges;
  }

  if (!selected.length) {
    notes.push('無可用 edge IP — 不修改 DNS（保留既有 managed 記錄）');
  }

  return { selected, strategy, notes, guarded };
}

function resolveZoneId(
  db: JsonStore,
  site: CdnSiteDto,
): { zoneId: string; zoneName: string } | null {
  if (site.dns.zoneId) {
    const z = getResource(db, 'dns_zones', site.dns.zoneId);
    if (z) return { zoneId: String(z.id), zoneName: String(z.zone) };
  }
  // Match longest zone name suffix against site domains
  const zones = listResources(db, 'dns_zones');
  let best: { zoneId: string; zoneName: string; len: number } | null = null;
  for (const domain of site.domains) {
    const d = domain.toLowerCase();
    for (const z of zones) {
      const zn = String(z.zone ?? '')
        .toLowerCase()
        .replace(/\.$/, '');
      if (!zn) continue;
      if (d === zn || d.endsWith(`.${zn}`)) {
        if (!best || zn.length > best.len) {
          best = { zoneId: String(z.id), zoneName: zn, len: zn.length };
        }
      }
    }
  }
  return best
    ? { zoneId: best.zoneId, zoneName: best.zoneName }
    : null;
}

/** Map FQDN to relative record name inside zone */
export function relativeDnsName(domain: string, zoneName: string): string {
  const d = domain.toLowerCase().replace(/\.$/, '');
  const z = zoneName.toLowerCase().replace(/\.$/, '');
  if (d === z) return '@';
  if (d.endsWith(`.${z}`)) return d.slice(0, -(z.length + 1));
  // domain not under zone — use full relative as-is (operator mistake)
  return d;
}

function collectEdgeSnapshot(node: CdnNodeDto): CdnHealthyEdge {
  return {
    node,
    healthy: isNodeHealthy(node),
    ipv4: [...(node.publicIpv4 ?? [])],
    ipv6: [...(node.publicIpv6 ?? [])],
    notes: [
      `status=${node.status}`,
      node.lastHealth
        ? `lastHealth=${node.lastHealth.ok ? 'ok' : 'fail'}`
        : 'lastHealth=none',
    ],
  };
}

/**
 * Sync CDN-managed A/AAAA for site domains from healthy edges.
 */
export async function syncCdnSiteDns(input: {
  db: JsonStore;
  dataDir: string;
  siteId: string;
  host?: HostExecutor;
  /** Probe edges before select (default true) */
  probeFirst?: boolean;
  /** Write zone file + optional named reload (default true when host) */
  applyZone?: boolean;
}): Promise<CdnDnsSyncResult> {
  const site = getCdnSite(input.db, input.siteId);
  if (!site) {
    throw new YskError(ErrorCodes.NOT_FOUND, '找不到 CDN 站點', {
      httpStatus: 404,
      details: { id: input.siteId },
    });
  }

  const notes: string[] = [];
  const edges: CdnHealthyEdge[] = [];

  for (const eid of site.edgeNodeIds) {
    let node = getCdnNode(input.db, eid);
    if (!node) {
      notes.push(`edge ${eid} 不存在 — 略過`);
      continue;
    }
    if (input.probeFirst !== false) {
      try {
        const p = await probeCdnNode(input.db, eid);
        node = p.node;
        notes.push(
          `probe ${node.name}: ${p.ok ? 'ok' : 'fail'} (${p.method})`,
        );
      } catch (e) {
        notes.push(
          `probe ${node.name} 例外：${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    edges.push(collectEdgeSnapshot(node));
  }

  const plan = planCdnDnsTargets({ site, edges });
  notes.push(...plan.notes);

  const selectedIpv4 = [
    ...new Set(plan.selected.flatMap((e) => e.ipv4)),
  ];
  const selectedIpv6 = [
    ...new Set(plan.selected.flatMap((e) => e.ipv6)),
  ];
  const selectedNodeIds = plan.selected.map((e) => e.node.id);

  if (!selectedIpv4.length && !selectedIpv6.length) {
    return {
      ok: false,
      apply_status: 'failed',
      siteId: site.id,
      strategy: plan.strategy,
      selectedNodeIds: [],
      selectedIpv4: [],
      selectedIpv6: [],
      recordsTouched: 0,
      notes: [...notes, '無 IP 可寫入 DNS'],
      edges,
    };
  }

  const zoneRef = resolveZoneId(input.db, site);
  if (!zoneRef) {
    return {
      ok: false,
      apply_status: 'failed',
      siteId: site.id,
      strategy: plan.strategy,
      selectedNodeIds,
      selectedIpv4,
      selectedIpv6,
      recordsTouched: 0,
      notes: [
        ...notes,
        '找不到 DNS zone — 請在站點 dns.zoneId 指定，或先建立匹配域名的 zone',
      ],
      edges,
    };
  }

  // Persist resolved zoneId on site if missing
  if (!site.dns.zoneId) {
    const { upsertCdnSite } = await import('./sites.js');
    upsertCdnSite(input.db, {
      ...site,
      name: site.name,
      dns: { ...site.dns, zoneId: zoneRef.zoneId },
    });
    notes.push(`已綁定 zoneId=${zoneRef.zoneId} (${zoneRef.zoneName})`);
  }

  const ttl =
    plan.selected.every((e) => e.healthy) && !plan.guarded
      ? site.dns.ttlHealthy || 60
      : site.dns.ttlUnhealthy || 30;

  let recordsTouched = 0;
  const allRecs = listResources(input.db, 'dns_records');

  for (const domain of site.domains) {
    const rel = relativeDnsName(domain, zoneRef.zoneName);
    // Remove only our managed RRset for this name+type under this site
    const managed = allRecs.filter(
      (r) =>
        r.zoneId === zoneRef.zoneId &&
        String(r.managedBy ?? '') === 'cdn' &&
        String(r.cdnSiteId ?? '') === site.id &&
        String(r.name ?? '@').toLowerCase() === rel.toLowerCase() &&
        (String(r.type).toUpperCase() === 'A' ||
          String(r.type).toUpperCase() === 'AAAA'),
    );
    for (const r of managed) {
      deleteResource(input.db, 'dns_records', String(r.id));
      recordsTouched += 1;
    }

    // Do not touch user-managed records with same name — warn if conflict
    const userConflict = listResources(input.db, 'dns_records').filter(
      (r) =>
        r.zoneId === zoneRef.zoneId &&
        String(r.managedBy ?? 'user') !== 'cdn' &&
        String(r.name ?? '@').toLowerCase() === rel.toLowerCase() &&
        (String(r.type).toUpperCase() === 'A' ||
          String(r.type).toUpperCase() === 'AAAA'),
    );
    if (userConflict.length) {
      notes.push(
        `名稱 ${rel} 已有 user 管理記錄 ${userConflict.length} 筆 — CDN 仍寫入 managedBy=cdn（可能並存；請檢查 zone）`,
      );
    }

    for (const ip of selectedIpv4) {
      createResource(input.db, 'dns_records', {
        zoneId: zoneRef.zoneId,
        type: 'A',
        name: rel,
        value: ip,
        ttl,
        managedBy: 'cdn',
        cdnSiteId: site.id,
        apply_status: 'draft',
      });
      recordsTouched += 1;
    }
    for (const ip of selectedIpv6) {
      createResource(input.db, 'dns_records', {
        zoneId: zoneRef.zoneId,
        type: 'AAAA',
        name: rel,
        value: ip,
        ttl,
        managedBy: 'cdn',
        cdnSiteId: site.id,
        apply_status: 'draft',
      });
      recordsTouched += 1;
    }
    notes.push(
      `${domain} → ${rel} A×${selectedIpv4.length} AAAA×${selectedIpv6.length} ttl=${ttl}`,
    );
  }

  let zoneApplied = false;
  let apply_status: ApplyStatus = 'written';
  let ok = true;
  let blocked = false;

  if (input.applyZone !== false) {
    const zr = await applyDnsZone(input.db, input.dataDir, zoneRef.zoneId, {
      host: input.host,
      validate: true,
      tryReload: Boolean(input.host?.executeEnabled()),
    });
    notes.push(...(zr.notes ?? []).map((n) => `zone: ${n}`));
    zoneApplied = zr.apply_status === 'applied';
    apply_status =
      (zr.apply_status as ApplyStatus) ||
      (zr.ok ? 'written' : 'failed');
    ok = zr.ok;
    blocked = Boolean(zr.blocked);
    if (zr.blocked) {
      notes.push('zone apply blocked（無 EXECUTE）— 記錄已更新於控制面');
      apply_status = 'written';
      ok = true; // control-plane DNS records still updated
    }
  } else {
    notes.push('略過 zone apply（applyZone=false）— 僅更新控制面 records');
  }

  notes.push(
    'DNS written ≠ 公網 resolver 立即生效（受 TTL／上游快取影響）',
  );

  return {
    ok,
    apply_status,
    siteId: site.id,
    strategy: plan.strategy,
    selectedNodeIds,
    selectedIpv4,
    selectedIpv6,
    recordsTouched,
    zoneId: zoneRef.zoneId,
    zoneApplied,
    notes,
    edges,
    blocked: blocked || undefined,
    requiresExecute: blocked || undefined,
  };
}

/**
 * Health loop step: probe site edges then DNS sync.
 */
export async function runCdnSiteHealthLoop(input: {
  db: JsonStore;
  dataDir: string;
  siteId: string;
  host?: HostExecutor;
  applyZone?: boolean;
}): Promise<CdnDnsSyncResult> {
  return syncCdnSiteDns({
    ...input,
    probeFirst: true,
    applyZone: input.applyZone,
  });
}

/**
 * Run health+dns for all sites (scheduler-friendly).
 */
export async function runAllCdnSitesHealthLoop(input: {
  db: JsonStore;
  dataDir: string;
  host?: HostExecutor;
  applyZone?: boolean;
}): Promise<{
  ok: boolean;
  notes: string[];
  results: CdnDnsSyncResult[];
}> {
  const { listCdnSites } = await import('./sites.js');
  const sites = listCdnSites(input.db);
  if (!sites.length) {
    return { ok: true, notes: ['尚無 CDN 站點'], results: [] };
  }
  const results: CdnDnsSyncResult[] = [];
  for (const s of sites) {
    results.push(
      await runCdnSiteHealthLoop({
        db: input.db,
        dataDir: input.dataDir,
        siteId: s.id,
        host: input.host,
        applyZone: input.applyZone,
      }),
    );
  }
  const ok = results.every((r) => r.ok);
  return {
    ok,
    notes: [
      `health-loop ${results.filter((r) => r.ok).length}/${results.length} sites ok`,
      ...results.map(
        (r) =>
          `${r.siteId.slice(0, 8)}: ${r.ok ? 'ok' : 'fail'} ${r.strategy} v4=${r.selectedIpv4.join(',')}`,
      ),
    ],
    results,
  };
}

/** List CDN-managed records for a site (debug/UI) */
export function listCdnManagedDnsRecords(
  db: JsonStore,
  siteId: string,
): Record<string, unknown>[] {
  return listResources(db, 'dns_records').filter(
    (r) =>
      String(r.managedBy ?? '') === 'cdn' &&
      String(r.cdnSiteId ?? '') === siteId,
  );
}
