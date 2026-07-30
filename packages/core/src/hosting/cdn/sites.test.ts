import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import { upsertCdnNode } from './nodes.js';
import {
  listCdnSites,
  upsertCdnSite,
  deleteCdnSite,
  getCdnSite,
} from './sites.js';
import {
  renderCdnEdgeNginxConf,
  applyCdnSiteEdgeRender,
} from './edge-render.js';

describe('cdn sites + edge render (PR-C2)', () => {
  it('CRUD site with edge binding', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdns-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'edge1',
        roles: ['edge'],
        publicIpv4: ['203.0.113.10'],
      });
      const site = upsertCdnSite(db, {
        name: 'demo',
        domains: ['cdn.example.com', 'www.cdn.example.com'],
        mode: 'origin_pull',
        origin: { kind: 'url', url: 'https://origin.example.com' },
        edgeNodeIds: [edge.id],
      });
      expect(listCdnSites(db)).toHaveLength(1);
      expect(site.domains).toContain('cdn.example.com');
      expect(site.apply_status).toBe('draft');
      expect(getCdnSite(db, site.id)?.edgeNodeIds).toEqual([edge.id]);
      expect(deleteCdnSite(db, site.id)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects site without nodes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdns-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      expect(() =>
        upsertCdnSite(db, {
          name: 'x',
          domains: ['a.example.com'],
          origin: { kind: 'url', url: 'https://o.example.com' },
          edgeNodeIds: ['missing'],
        }),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders proxy_cache conf with health location', () => {
    const site = {
      id: 'site-abc',
      name: 'demo',
      domains: ['example.com'],
      mode: 'origin_pull' as const,
      origin: { kind: 'url' as const, url: 'https://origin.example.com' },
      edgeNodeIds: ['e1'],
      dns: {
        strategy: 'multi_a' as const,
        ttlHealthy: 60,
        ttlUnhealthy: 30,
        minHealthyEdges: 1,
      },
      cache: {
        enabled: true,
        zoneSize: '10m',
        maxAge: '10m',
        bypassCookies: true,
        bypassAuth: true,
      },
      ssl: { mode: 'off' as const },
      apply_status: 'draft' as const,
      edge_status: {},
    };
    const r = renderCdnEdgeNginxConf({ site });
    expect(r.conf).toContain('proxy_cache_path');
    expect(r.conf).toContain('server_name example.com');
    expect(r.conf).toContain('/.ysk-cdn-health');
    expect(r.conf).toContain('proxy_pass https://origin.example.com');
    expect(r.conf).toContain('X-YSK-Cache');
    expect(r.contentHash).toHaveLength(16);
    expect(r.originUpstream).toBe('https://origin.example.com');
  });

  it('apply writes managed conf and sets written/planned edges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdns-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'edge1',
        roles: ['edge'],
        publicIpv4: ['203.0.113.11'],
      });
      const site = upsertCdnSite(db, {
        name: 'demo',
        domains: ['app.example.com'],
        origin: { kind: 'url', url: 'http://127.0.0.1:3000' },
        edgeNodeIds: [edge.id],
        mode: 'reverse_proxy',
      });
      const dry = await applyCdnSiteEdgeRender({
        db,
        dataDir: dir,
        siteId: site.id,
        dryRun: true,
      });
      expect(dry.apply_status).toBe('planned');
      expect(dry.written).toHaveLength(0);
      expect(dry.conf).toContain('app.example.com');

      const applied = await applyCdnSiteEdgeRender({
        db,
        dataDir: dir,
        siteId: site.id,
        dryRun: false,
      });
      expect(applied.ok).toBe(true);
      expect(applied.apply_status).toBe('written');
      expect(existsSync(applied.confPath)).toBe(true);
      const body = readFileSync(applied.confPath, 'utf8');
      expect(body).toContain('proxy_pass http://127.0.0.1:3000');
      expect(applied.edge_status[edge.id]).toBe('planned');
      const stored = getCdnSite(db, site.id)!;
      expect(stored.apply_status).toBe('written');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
