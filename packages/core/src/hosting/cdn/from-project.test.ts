import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import { upsertCdnNode } from './nodes.js';
import {
  domainsFromProject,
  enableCdnFromProject,
  projectOriginUrl,
} from './from-project.js';
import type { ProjectDto } from '@ysk-server/shared';
import { selectGeoEdges } from './dns-sync.js';
import type { CdnHealthyEdge } from './dns-sync.js';
import type { CdnSiteDto } from '@ysk-server/shared';

const baseProject = (over: Partial<ProjectDto> = {}): ProjectDto => ({
  id: 'proj-1',
  name: 'Demo',
  domain: 'demo.example.com',
  domainAliases: ['www.demo.example.com'],
  linuxUser: 'ysk_demo',
  linuxGroup: 'ysk_demo',
  homeDir: '/home/ysk-server-proj-1',
  runtime: 'node',
  env: 'production',
  port: 3000,
  ...over,
});

describe('cdn from-project + geo (PR-C7)', () => {
  it('domainsFromProject and projectOriginUrl', () => {
    const p = baseProject();
    expect(domainsFromProject(p)).toEqual([
      'demo.example.com',
      'www.demo.example.com',
    ]);
    expect(projectOriginUrl(p)).toBe('http://127.0.0.1:3000');
  });

  it('enableCdnFromProject creates site bound to project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfp-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const e1 = upsertCdnNode(db, {
        name: 'edge1',
        roles: ['edge'],
        publicIpv4: ['203.0.113.1'],
        region: 'hkg',
      });
      const e2 = upsertCdnNode(db, {
        name: 'edge2',
        roles: ['edge'],
        publicIpv4: ['203.0.113.2'],
        region: 'nrt',
      });
      const r = enableCdnFromProject({
        db,
        project: baseProject(),
        strategy: 'geo',
        geoMap: {
          hkg: [e1.id],
          nrt: [e2.id],
        },
        geoSubdomains: true,
        originShieldNodeId: e1.id,
      });
      expect(r.ok).toBe(true);
      expect(r.created).toBe(true);
      expect(r.site.origin.kind).toBe('project');
      expect(r.site.origin.projectId).toBe('proj-1');
      expect(r.site.domains).toContain('demo.example.com');
      expect(r.site.dns.strategy).toBe('geo');
      expect(r.site.originShieldNodeId).toBe(e1.id);
      expect(r.site.dns.geoSubdomains).toBe(true);

      // idempotent update
      const r2 = enableCdnFromProject({
        db,
        project: baseProject(),
      });
      expect(r2.created).toBe(false);
      expect(r2.site.id).toBe(r.site.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('selectGeoEdges filters by geoMap', () => {
    const edges: CdnHealthyEdge[] = [
      {
        node: {
          id: 'a',
          name: 'a',
          region: 'hkg',
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
          region: 'nrt',
          weight: 100,
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
          region: 'hkg',
          weight: 50,
          status: 'offline',
        } as never,
        healthy: false,
        ipv4: ['3.3.3.3'],
        ipv6: [],
        notes: [],
      },
    ];
    const site = {
      dns: {
        strategy: 'geo' as const,
        ttlHealthy: 60,
        ttlUnhealthy: 30,
        minHealthyEdges: 1,
        geoMap: { hkg: ['a', 'c'], nrt: ['b'] },
        geoDefaultRegion: 'hkg',
      },
    } as unknown as CdnSiteDto;
    const geo = selectGeoEdges({
      site,
      healthy: edges.filter((e) => e.healthy),
      allEdges: edges,
    });
    expect(geo.selected.map((e) => e.node.id).sort()).toEqual(['a', 'b']);
    expect(geo.byRegion.hkg).toHaveLength(1);
    expect(geo.byRegion.nrt).toHaveLength(1);
  });
});
