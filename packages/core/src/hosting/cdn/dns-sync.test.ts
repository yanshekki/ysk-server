import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import {
  createResource,
  listResources,
} from '../managed-resources.js';
import { upsertCdnNode } from './nodes.js';
import { upsertCdnSite } from './sites.js';
import {
  planCdnDnsTargets,
  expandWeightedRRset,
  relativeDnsName,
  syncCdnSiteDns,
  listCdnManagedDnsRecords,
} from './dns-sync.js';
import type { CdnSiteDto } from '@ysk-server/shared';

describe('cdn dns-sync (PR-C4/C5)', () => {
  it('relativeDnsName maps apex and sub', () => {
    expect(relativeDnsName('example.com', 'example.com')).toBe('@');
    expect(relativeDnsName('www.example.com', 'example.com')).toBe('www');
    expect(relativeDnsName('cdn.example.com', 'example.com')).toBe('cdn');
  });

  it('plan multi_a vs failover vs minHealthy guard', () => {
    const site = {
      dns: {
        strategy: 'multi_a' as const,
        ttlHealthy: 60,
        ttlUnhealthy: 30,
        minHealthyEdges: 1,
      },
    } as CdnSiteDto;
    const edges = [
      {
        node: {
          id: 'a',
          name: 'a',
          weight: 100,
          status: 'online',
        } as never,
        healthy: true,
        ipv4: ['1.1.1.1'],
        ipv6: [],
        notes: [],
      },
      {
        node: {
          id: 'b',
          name: 'b',
          weight: 50,
          status: 'online',
        } as never,
        healthy: true,
        ipv4: ['2.2.2.2'],
        ipv6: [],
        notes: [],
      },
      {
        node: {
          id: 'c',
          name: 'c',
          weight: 10,
          status: 'offline',
        } as never,
        healthy: false,
        ipv4: ['3.3.3.3'],
        ipv6: [],
        notes: [],
      },
    ];
    const multi = planCdnDnsTargets({ site, edges });
    expect(multi.selected).toHaveLength(2);

    const fail = planCdnDnsTargets({
      site: {
        ...site,
        dns: { ...site.dns, strategy: 'failover' },
      },
      edges,
    });
    expect(fail.selected).toHaveLength(1);
    expect(fail.selected[0].ipv4[0]).toBe('1.1.1.1');

    const noneHealthy = planCdnDnsTargets({
      site: {
        ...site,
        dns: { ...site.dns, strategy: 'failover', minHealthyEdges: 1 },
      },
      edges: edges.map((e) => ({ ...e, healthy: false })),
    });
    expect(noneHealthy.guarded).toBe(true);
    expect(noneHealthy.selected.length).toBeGreaterThan(0);
  });

  it('weighted expands RRset by weight ratio (PR-C5)', () => {
    const edges = [
      {
        node: { id: 'a', name: 'heavy', weight: 200, status: 'online' } as never,
        healthy: true,
        ipv4: ['1.1.1.1'],
        ipv6: [],
        notes: [],
      },
      {
        node: { id: 'b', name: 'light', weight: 100, status: 'online' } as never,
        healthy: true,
        ipv4: ['2.2.2.2'],
        ipv6: [],
        notes: [],
      },
    ];
    const exp = expandWeightedRRset(edges);
    // 200:100 → 2:1
    expect(exp.ipv4.filter((ip) => ip === '1.1.1.1').length).toBe(2);
    expect(exp.ipv4.filter((ip) => ip === '2.2.2.2').length).toBe(1);
    expect(exp.replicaPlan[0].copies).toBe(2);

    const plan = planCdnDnsTargets({
      site: {
        dns: {
          strategy: 'weighted',
          ttlHealthy: 60,
          ttlUnhealthy: 30,
          minHealthyEdges: 1,
        },
      } as CdnSiteDto,
      edges,
    });
    expect(plan.ipv4RRset.length).toBe(3);
    expect(plan.weightedPlan?.length).toBe(2);
  });

  it('sync writes managedBy=cdn A records and leaves user records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdndns-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const zone = createResource(db, 'dns_zones', {
        zone: 'example.com',
        serverIp: '9.9.9.9',
        apply_status: 'draft',
      });
      // user record that must not be deleted
      createResource(db, 'dns_records', {
        zoneId: zone.id,
        type: 'TXT',
        name: '@',
        value: 'v=spf1 -all',
        ttl: 300,
        managedBy: 'user',
      });
      createResource(db, 'dns_records', {
        zoneId: zone.id,
        type: 'A',
        name: 'www',
        value: '8.8.8.8',
        ttl: 300,
        managedBy: 'user',
      });

      const e1 = upsertCdnNode(db, {
        name: 'edge1',
        roles: ['edge'],
        publicIpv4: ['203.0.113.10'],
        status: 'online',
      });
      const e2 = upsertCdnNode(db, {
        name: 'edge2',
        roles: ['edge'],
        publicIpv4: ['203.0.113.11'],
        status: 'online',
      });
      // mark lastHealth so isNodeHealthy works without live probe
      const { upsertCdnNode: up } = await import('./nodes.js');
      up(db, {
        ...e1,
        name: e1.name,
        status: 'online',
      });
      // force status online via store patch after probe skip
      const site = upsertCdnSite(db, {
        name: 'site1',
        domains: ['www.example.com', 'example.com'],
        origin: { kind: 'url', url: 'https://origin.example.com' },
        edgeNodeIds: [e1.id, e2.id],
        dns: {
          zoneId: String(zone.id),
          strategy: 'multi_a',
          ttlHealthy: 60,
          ttlUnhealthy: 30,
          minHealthyEdges: 1,
        },
      });

      // Ensure nodes are online for plan without network probe
      for (const id of [e1.id, e2.id]) {
        const n = listResources(db, 'dns_zones'); // touch
        void n;
        up(db, {
          id,
          name: id === e1.id ? 'edge1' : 'edge2',
          roles: ['edge'],
          publicIpv4: id === e1.id ? ['203.0.113.10'] : ['203.0.113.11'],
          status: 'online',
        });
      }

      const r = await syncCdnSiteDns({
        db,
        dataDir: dir,
        siteId: site.id,
        probeFirst: false,
        applyZone: false,
      });
      expect(r.ok).toBe(true);
      expect(r.selectedIpv4.sort()).toEqual(
        ['203.0.113.10', '203.0.113.11'].sort(),
      );
      expect(r.recordsTouched).toBeGreaterThan(0);

      const managed = listCdnManagedDnsRecords(db, site.id);
      expect(managed.every((m) => m.managedBy === 'cdn')).toBe(true);
      expect(
        managed.filter((m) => m.type === 'A' && m.name === 'www'),
      ).toHaveLength(2);
      expect(
        managed.filter((m) => m.type === 'A' && m.name === '@'),
      ).toHaveLength(2);

      // user records intact
      const userWww = listResources(db, 'dns_records').find(
        (x) =>
          x.managedBy === 'user' && x.name === 'www' && x.type === 'A',
      );
      expect(userWww?.value).toBe('8.8.8.8');
      const txt = listResources(db, 'dns_records').find(
        (x) => x.type === 'TXT' && x.managedBy === 'user',
      );
      expect(txt).toBeTruthy();

      // failover reduces to 1 IP
      const { upsertCdnSite: upSite } = await import('./sites.js');
      upSite(db, {
        id: site.id,
        name: site.name,
        domains: site.domains,
        edgeNodeIds: site.edgeNodeIds,
        origin: site.origin,
        dns: {
          ...site.dns,
          zoneId: String(zone.id),
          strategy: 'failover',
        },
      });
      // mark e2 offline
      up(db, {
        id: e2.id,
        name: 'edge2',
        roles: ['edge'],
        publicIpv4: ['203.0.113.11'],
        status: 'offline',
      });
      const r2 = await syncCdnSiteDns({
        db,
        dataDir: dir,
        siteId: site.id,
        probeFirst: false,
        applyZone: false,
      });
      expect(r2.selectedIpv4).toEqual(['203.0.113.10']);
      const wwwA = listCdnManagedDnsRecords(db, site.id).filter(
        (m) => m.type === 'A' && m.name === 'www',
      );
      expect(wwwA).toHaveLength(1);
      expect(wwwA[0].value).toBe('203.0.113.10');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
