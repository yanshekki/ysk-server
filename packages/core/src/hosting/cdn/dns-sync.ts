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
  type CdnSiteDto,  tl} from '@yanshekki/shared';
import type { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import {
  createResource,
  deleteResource,
  getResource,
  listResources,
  applyDnsZone } from '../managed-resources.js';
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
  /** Weighted replica plan (PR-C5) */
  weightedPlan?: Array<{ name: string; weight: number; copies: number }>;
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

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function gcdAll(nums: number[]): number {
  return nums.reduce((g, n) => gcd(g, n), nums[0] || 1);
}

/**
 * Geo selection (PR-C7): geoMap region → edge ids.
 * Without EDNS/Anycast we publish union of healthy geo edges for apex.
 * Prefer geoDefaultRegion edges when strategy needs a primary set.
 */
export function selectGeoEdges(input: {
  site: CdnSiteDto;
  healthy: CdnHealthyEdge[];
  allEdges: CdnHealthyEdge[];
}): { selected: CdnHealthyEdge[]; notes: string[]; byRegion: Record<string, CdnHealthyEdge[]> } {
  const notes: string[] = [];
  const map = input.site.dns.geoMap ?? {};
  const regions = Object.keys(map);
  const byRegion: Record<string, CdnHealthyEdge[]> = {};

  if (!regions.length) {
    notes.push(
      tl('notes.auto.n0299'),
    );
    return { selected: input.healthy, notes, byRegion };
  }

  const idToEdge = new Map(input.allEdges.map((e) => [e.node.id, e]));
  const selectedIds = new Set<string>();

  for (const [region, ids] of Object.entries(map)) {
    const list: CdnHealthyEdge[] = [];
    for (const id of ids ?? []) {
      const e = idToEdge.get(id);
      if (!e) {
        notes.push(tl('notes.auto.t0739', { v0: (region), v1: (id) }));
        continue;
      }
      if (e.healthy) {
        list.push(e);
        selectedIds.add(e.node.id);
      }
    }
    byRegion[region] = list;
    notes.push(
      `geo ${region}: ${list.length} healthy / ${(ids ?? []).length} mapped`,
    );
  }

  let selected = input.healthy.filter((e) => selectedIds.has(e.node.id));
  const prefer = input.site.dns.geoDefaultRegion?.trim();
  if (prefer && byRegion[prefer]?.length) {
    notes.push(`geoDefaultRegion=${prefer}（${byRegion[prefer].length} edges）`);
  }

  if (!selected.length) {
    notes.push(tl('notes.auto.n0298'));
    selected = input.healthy;
  } else {
    notes.push(
      tl('notes.auto.n0297'),
    );
  }

  return { selected, notes, byRegion };
}

/**
 * Expand healthy edges into A/AAAA RRset by weight (PR-C5).
 * Higher weight → more duplicate A records (round-robin bias).
 * Some resolvers collapse duplicates — notes are honest about this limit.
 */
export function expandWeightedRRset(
  edges: CdnHealthyEdge[],
  opts?: { maxRr?: number },
): { ipv4: string[]; ipv6: string[]; notes: string[]; replicaPlan: Array<{ name: string; weight: number; copies: number }> } {
  const maxRr = opts?.maxRr ?? 20;
  const notes: string[] = [];
  if (!edges.length) {
    return { ipv4: [], ipv6: [], notes: [tl('notes.auto.n0466')], replicaPlan: [] };
  }

  const weights = edges.map((e) => Math.max(1, Math.round(e.node.weight || 100)));
  const g = gcdAll(weights);
  let copies = weights.map((w) => Math.max(1, Math.round(w / g)));
  let total = copies.reduce((a, b) => a + b, 0);

  if (total > maxRr) {
    const scale = maxRr / total;
    copies = copies.map((c) => Math.max(1, Math.round(c * scale)));
    // trim if still over
    while (copies.reduce((a, b) => a + b, 0) > maxRr) {
      const i = copies.indexOf(Math.max(...copies));
      if (copies[i] <= 1) break;
      copies[i] -= 1;
    }
    total = copies.reduce((a, b) => a + b, 0);
    notes.push(tl('notes.auto.t0740', { v0: (maxRr), v1: (total) }));
  }

  const ipv4: string[] = [];
  const ipv6: string[] = [];
  const replicaPlan: Array<{ name: string; weight: number; copies: number }> = [];

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const n = copies[i];
    replicaPlan.push({
      name: e.node.name,
      weight: weights[i],
      copies: n });
    for (let c = 0; c < n; c++) {
      for (const ip of e.ipv4) ipv4.push(ip);
      for (const ip of e.ipv6) ipv6.push(ip);
    }
  }

  notes.push(
    `weighted RRset: ${replicaPlan.map((p) => `${p.name}×${p.copies}(w=${p.weight})`).join(', ')}`,
  );
  notes.push(
    tl('notes.auto.n1377'),
  );

  return { ipv4, ipv6, notes, replicaPlan };
}

/**
 * Pick edge IPs by strategy + minHealthyEdges guard.
 * Returns selected edges plus ready-to-write RRsets (weighted may repeat IPs).
 */
export function planCdnDnsTargets(input: {
  site: CdnSiteDto;
  edges: CdnHealthyEdge[];
}): {
  selected: CdnHealthyEdge[];
  strategy: CdnDnsStrategy;
  notes: string[];
  guarded: boolean;
  /** Final A RRset values (may contain duplicates for weighted) */
  ipv4RRset: string[];
  ipv6RRset: string[];
  weightedPlan?: Array<{ name: string; weight: number; copies: number }>;
  geoByRegion?: Record<string, CdnHealthyEdge[]>;
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
  let weightedPlan:
    | Array<{ name: string; weight: number; copies: number }>
    | undefined;
  let geoByRegion: Record<string, CdnHealthyEdge[]> | undefined;

  if (strategy === 'failover' || strategy === 'single') {
    const ordered = [...healthy].sort(
      (a, b) => (b.node.weight || 0) - (a.node.weight || 0),
    );
    if (ordered.length) {
      selected = [ordered[0]];
    }
  } else if (strategy === 'weighted') {
    const ordered = [...healthy].sort(
      (a, b) => (b.node.weight || 0) - (a.node.weight || 0),
    );
    selected = ordered;
  } else if (strategy === 'geo') {
    const geo = selectGeoEdges({
      site: input.site,
      healthy,
      allEdges: input.edges });
    selected = geo.selected;
    geoByRegion = geo.byRegion;
    notes.push(...geo.notes);
  } else {
    selected = healthy;
  }

  if (selected.length < minH) {
    guarded = true;
    notes.push(
      tl('notes.auto.t0741', { v0: (minH), v1: (selected.length) }),
    );
    selected = allWithIp.length ? allWithIp : input.edges;
  }

  if (!selected.length) {
    notes.push(tl('notes.auto.n1098'));
  }

  let ipv4RRset: string[];
  let ipv6RRset: string[];

  if (strategy === 'weighted' && selected.length && !guarded) {
    const exp = expandWeightedRRset(selected);
    ipv4RRset = exp.ipv4;
    ipv6RRset = exp.ipv6;
    weightedPlan = exp.replicaPlan;
    notes.push(...exp.notes);
  } else {
    // unique IPs for multi_a / failover / guarded fallback
    ipv4RRset = [...new Set(selected.flatMap((e) => e.ipv4))];
    ipv6RRset = [...new Set(selected.flatMap((e) => e.ipv6))];
  }

  return {
    selected,
    strategy,
    notes,
    guarded,
    ipv4RRset,
    ipv6RRset,
    weightedPlan,
    geoByRegion };
}

function writeManagedARecords(input: {
  db: JsonStore;
  zoneId: string;
  siteId: string;
  relName: string;
  ipv4: string[];
  ipv6: string[];
  ttl: number;
}): number {
  let touched = 0;
  const allRecs = listResources(input.db, 'dns_records');
  const managed = allRecs.filter(
    (r) =>
      r.zoneId === input.zoneId &&
      String(r.managedBy ?? '') === 'cdn' &&
      String(r.cdnSiteId ?? '') === input.siteId &&
      String(r.name ?? '@').toLowerCase() === input.relName.toLowerCase() &&
      (String(r.type).toUpperCase() === 'A' ||
        String(r.type).toUpperCase() === 'AAAA'),
  );
  for (const r of managed) {
    deleteResource(input.db, 'dns_records', String(r.id));
    touched += 1;
  }
  for (const ip of input.ipv4) {
    createResource(input.db, 'dns_records', {
      zoneId: input.zoneId,
      type: 'A',
      name: input.relName,
      value: ip,
      ttl: input.ttl,
      managedBy: 'cdn',
      cdnSiteId: input.siteId,
      apply_status: 'draft' });
    touched += 1;
  }
  for (const ip of input.ipv6) {
    createResource(input.db, 'dns_records', {
      zoneId: input.zoneId,
      type: 'AAAA',
      name: input.relName,
      value: ip,
      ttl: input.ttl,
      managedBy: 'cdn',
      cdnSiteId: input.siteId,
      apply_status: 'draft' });
    touched += 1;
  }
  return touched;
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
    ] };
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
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.cdn.siteNotFound'), {
      httpStatus: 404,
      details: { id: input.siteId } });
  }

  const notes: string[] = [];
  const edges: CdnHealthyEdge[] = [];

  for (const eid of site.edgeNodeIds) {
    let node = getCdnNode(input.db, eid);
    if (!node) {
      notes.push(tl('notes.auto.t0742', { v0: (eid) }));
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
          tl('notes.auto.t0743', { v0: (node.name), v1: (e instanceof Error ? e.message : String(e)) }),
        );
      }
    }
    edges.push(collectEdgeSnapshot(node));
  }

  const plan = planCdnDnsTargets({ site, edges });
  notes.push(...plan.notes);

  // Use RRset from planner (weighted may repeat IPs)
  const selectedIpv4 = plan.ipv4RRset;
  const selectedIpv6 = plan.ipv6RRset;
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
      weightedPlan: plan.weightedPlan,
      recordsTouched: 0,
      notes: [...notes, tl('notes.auto.n1060')],
      edges };
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
      weightedPlan: plan.weightedPlan,
      recordsTouched: 0,
      notes: [
        ...notes,
        tl('notes.auto.n0845'),
      ],
      edges };
  }

  // Persist resolved zoneId on site if missing
  if (!site.dns.zoneId) {
    const { upsertCdnSite } = await import('./sites.js');
    upsertCdnSite(input.db, {
      ...site,
      name: site.name,
      dns: { ...site.dns, zoneId: zoneRef.zoneId } });
    notes.push(tl('notes.auto.t0744', { v0: (zoneRef.zoneId), v1: (zoneRef.zoneName) }));
  }

  const ttl =
    plan.selected.every((e) => e.healthy) && !plan.guarded
      ? site.dns.ttlHealthy || 60
      : site.dns.ttlUnhealthy || 30;

  let recordsTouched = 0;

  for (const domain of site.domains) {
    const rel = relativeDnsName(domain, zoneRef.zoneName);
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
        tl('notes.auto.t0745', { v0: (rel), v1: (userConflict.length) }),
      );
    }

    recordsTouched += writeManagedARecords({
      db: input.db,
      zoneId: zoneRef.zoneId,
      siteId: site.id,
      relName: rel,
      ipv4: selectedIpv4,
      ipv6: selectedIpv6,
      ttl });
    notes.push(
      `${domain} → ${rel} A×${selectedIpv4.length} AAAA×${selectedIpv6.length} ttl=${ttl}`,
    );
  }

  // Geo subdomains: hkg.example.com style relative name "hkg" under zone
  if (
    plan.strategy === 'geo' &&
    site.dns.geoSubdomains &&
    plan.geoByRegion
  ) {
    for (const [region, regionEdges] of Object.entries(plan.geoByRegion)) {
      const slug = region
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-|-$/g, '');
      if (!slug || slug === '@') continue;
      const v4 = [
        ...new Set(regionEdges.flatMap((e) => e.ipv4)),
      ];
      const v6 = [
        ...new Set(regionEdges.flatMap((e) => e.ipv6)),
      ];
      if (!v4.length && !v6.length) {
        notes.push(tl('notes.auto.t0746', { v0: (slug) }));
        continue;
      }
      recordsTouched += writeManagedARecords({
        db: input.db,
        zoneId: zoneRef.zoneId,
        siteId: site.id,
        relName: slug,
        ipv4: v4,
        ipv6: v6,
        ttl });
      notes.push(
        `geo subdomain ${slug} → A×${v4.length} AAAA×${v6.length}`,
      );
    }
  }

  let zoneApplied = false;
  let apply_status: ApplyStatus = 'written';
  let ok = true;
  let blocked = false;

  if (input.applyZone !== false) {
    const zr = await applyDnsZone(input.db, input.dataDir, zoneRef.zoneId, {
      host: input.host,
      validate: true,
      tryReload: Boolean(input.host?.executeEnabled()) });
    notes.push(...(zr.notes ?? []).map((n) => `zone: ${n}`));
    zoneApplied = zr.apply_status === 'applied';
    apply_status =
      (zr.apply_status as ApplyStatus) ||
      (zr.ok ? 'written' : 'failed');
    ok = zr.ok;
    blocked = Boolean(zr.blocked);
    if (zr.blocked) {
      notes.push(tl('notes.auto.n0481'));
      apply_status = 'written';
      ok = true; // control-plane DNS records still updated
    }
  } else {
    notes.push(tl('notes.auto.n1260'));
  }

  notes.push(
    tl('notes.auto.n0098'),
  );

  return {
    ok,
    apply_status,
    siteId: site.id,
    strategy: plan.strategy,
    selectedNodeIds,
    selectedIpv4,
    selectedIpv6,
    weightedPlan: plan.weightedPlan,
    recordsTouched,
    zoneId: zoneRef.zoneId,
    zoneApplied,
    notes,
    edges,
    blocked: blocked || undefined,
    requiresExecute: blocked || undefined };
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
    applyZone: input.applyZone });
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
    return { ok: true, notes: [tl('notes.auto.n0716')], results: [] };
  }
  const results: CdnDnsSyncResult[] = [];
  for (const s of sites) {
    results.push(
      await runCdnSiteHealthLoop({
        db: input.db,
        dataDir: input.dataDir,
        siteId: s.id,
        host: input.host,
        applyZone: input.applyZone }),
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
    results };
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
