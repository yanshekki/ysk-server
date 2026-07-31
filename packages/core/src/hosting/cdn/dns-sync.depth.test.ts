import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import { createResource } from '../managed-resources.js';
import { upsertCdnNode } from './nodes.js';
import { upsertCdnSite, listCdnSites } from './sites.js';
import {
  selectGeoEdges,
  expandWeightedRRset,
  planCdnDnsTargets,
  relativeDnsName,
  syncCdnSiteDns,
  runAllCdnSitesHealthLoop,
  listCdnManagedDnsRecords,
} from './dns-sync.js';
import type { CdnSiteDto, CdnNodeDto } from '@ysk/shared';

function edge(
  id: string,
  opts: {
    healthy?: boolean;
    weight?: number;
    ipv4?: string[];
    ipv6?: string[];
    status?: string;
  } = {},
) {
  return {
    node: {
      id,
      name: id,
      weight: opts.weight ?? 100,
      status: opts.status ?? (opts.healthy === false ? 'offline' : 'online'),
    } as CdnNodeDto,
    healthy: opts.healthy !== false,
    ipv4: opts.ipv4 ?? [`1.0.0.${id.length}`],
    ipv6: opts.ipv6 ?? [],
    notes: [],
  };
}

describe('cdn dns-sync depth', () => {
  it('selectGeoEdges empty map returns healthy; maps regions', () => {
    const healthy = [edge('e1'), edge('e2')];
    const empty = selectGeoEdges({
      site: { dns: {} } as CdnSiteDto,
      healthy,
      allEdges: healthy,
    });
    expect(empty.selected).toHaveLength(2);

    const all = [...healthy, edge('e3', { healthy: false })];
    const geo = selectGeoEdges({
      site: {
        dns: {
          geoMap: { hkg: ['e1', 'missing'], nrt: ['e2'] },
          geoDefaultRegion: 'hkg',
        },
      } as CdnSiteDto,
      healthy,
      allEdges: all,
    });
    expect(geo.selected.length).toBeGreaterThan(0);
    expect(geo.byRegion.hkg?.length).toBe(1);
    expect(geo.notes.some((n) => /missing|hkg|geo/i.test(n))).toBe(true);
  });

  it('geo fallback when no healthy mapped edges', () => {
    const healthy = [edge('a')];
    const geo = selectGeoEdges({
      site: {
        dns: { geoMap: { x: ['dead'] } },
      } as CdnSiteDto,
      healthy,
      allEdges: healthy,
    });
    expect(geo.selected).toEqual(healthy);
  });

  it('expandWeightedRRset empty and maxRr trim', () => {
    expect(expandWeightedRRset([]).ipv4).toHaveLength(0);
    const many = [
      edge('h', { weight: 1000, ipv4: ['9.9.9.9'] }),
      edge('l', { weight: 1, ipv4: ['8.8.8.8'] }),
    ];
    const exp = expandWeightedRRset(many, { maxRr: 3 });
    expect(exp.ipv4.length).toBeLessThanOrEqual(6); // each copy can add 1 v4
    expect(exp.replicaPlan.reduce((a, p) => a + p.copies, 0)).toBeLessThanOrEqual(3);
  });

  it('plan strategies: single, geo, empty selection notes', () => {
    const edges = [
      edge('a', { weight: 10, ipv4: ['1.1.1.1'] }),
      edge('b', { weight: 200, ipv4: ['2.2.2.2'], ipv6: ['2001:db8::1'] }),
    ];
    const single = planCdnDnsTargets({
      site: {
        dns: { strategy: 'single', minHealthyEdges: 1, ttlHealthy: 60, ttlUnhealthy: 30 },
      } as CdnSiteDto,
      edges,
    });
    expect(single.selected).toHaveLength(1);
    expect(single.selected[0]!.node.id).toBe('b');

    const geoPlan = planCdnDnsTargets({
      site: {
        dns: {
          strategy: 'geo',
          minHealthyEdges: 1,
          ttlHealthy: 60,
          ttlUnhealthy: 30,
          geoMap: { r1: ['a'] },
        },
      } as CdnSiteDto,
      edges,
    });
    expect(geoPlan.geoByRegion).toBeTruthy();
    expect(geoPlan.ipv4RRset.length).toBeGreaterThan(0);

    const none = planCdnDnsTargets({
      site: {
        dns: { strategy: 'multi_a', minHealthyEdges: 1, ttlHealthy: 60, ttlUnhealthy: 30 },
      } as CdnSiteDto,
      edges: [],
    });
    expect(none.notes.length).toBeGreaterThan(0);
  });

  it('relativeDnsName outside zone returns full domain', () => {
    expect(relativeDnsName('other.test', 'example.com')).toBe('other.test');
  });

  it('sync fails without zone and without IPs; geo subdomains write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdn-d-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const n1 = upsertCdnNode(db, {
        name: 'g1',
        roles: ['edge'],
        publicIpv4: ['203.0.113.1'],
        status: 'online',
      });
      const n2 = upsertCdnNode(db, {
        name: 'g2',
        roles: ['edge'],
        publicIpv4: ['203.0.113.2'],
        publicIpv6: ['2001:db8::2'],
        status: 'online',
      });

      const noZone = upsertCdnSite(db, {
        name: 'noz',
        domains: ['orphan.example'],
        origin: { kind: 'url', url: 'https://o.example' },
        edgeNodeIds: [n1.id],
        dns: {
          strategy: 'multi_a',
          ttlHealthy: 60,
          ttlUnhealthy: 30,
          minHealthyEdges: 1,
        },
      });
      const rNoZone = await syncCdnSiteDns({
        db,
        dataDir: dir,
        siteId: noZone.id,
        probeFirst: false,
        applyZone: false,
      });
      expect(rNoZone.ok).toBe(false);
      expect(rNoZone.recordsTouched).toBe(0);

      // Node with only healthUrl but no public IPs → sync has no RRset
      const noIpNode = upsertCdnNode(db, {
        name: 'empty',
        roles: ['edge'],
        healthUrl: 'https://203.0.113.99/health',
        status: 'online',
      });
      const noIpSite = upsertCdnSite(db, {
        name: 'noip',
        domains: ['x.example'],
        origin: { kind: 'url', url: 'https://o.example' },
        edgeNodeIds: [noIpNode.id],
        dns: {
          strategy: 'multi_a',
          ttlHealthy: 60,
          ttlUnhealthy: 30,
          minHealthyEdges: 1,
        },
      });
      const rNoIp = await syncCdnSiteDns({
        db,
        dataDir: dir,
        siteId: noIpSite.id,
        probeFirst: false,
        applyZone: false,
      });
      expect(rNoIp.ok).toBe(false);

      const zone = createResource(db, 'dns_zones', {
        zone: 'example.com',
        serverIp: '9.9.9.9',
        apply_status: 'draft',
      });
      const geoSite = upsertCdnSite(db, {
        name: 'geo',
        domains: ['www.example.com'],
        origin: { kind: 'url', url: 'https://origin.example.com' },
        edgeNodeIds: [n1.id, n2.id],
        dns: {
          zoneId: String(zone.id),
          strategy: 'geo',
          ttlHealthy: 60,
          ttlUnhealthy: 30,
          minHealthyEdges: 1,
          geoMap: { hkg: [n1.id], nrt: [n2.id] },
          geoSubdomains: true,
          geoDefaultRegion: 'hkg',
        },
      });
      const geoR = await syncCdnSiteDns({
        db,
        dataDir: dir,
        siteId: geoSite.id,
        probeFirst: false,
        applyZone: false,
      });
      expect(geoR.ok).toBe(true);
      expect(geoR.strategy).toBe('geo');
      const managed = listCdnManagedDnsRecords(db, geoSite.id);
      expect(managed.some((m) => m.name === 'hkg' || m.name === 'nrt')).toBe(true);
      expect(managed.some((m) => m.type === 'AAAA')).toBe(true);
      // health-loop always probeFirst — only assert empty path elsewhere
      expect(listCdnSites(db).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runAllCdnSitesHealthLoop empty db', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdn-empty-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const r = await runAllCdnSitesHealthLoop({ db, dataDir: dir, applyZone: false });
      expect(r.ok).toBe(true);
      expect(r.results).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sync missing site throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdn-miss-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      await expect(
        syncCdnSiteDns({ db, dataDir: dir, siteId: 'nope', probeFirst: false }),
      ).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
