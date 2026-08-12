import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { upsertCdnNode } from './nodes.js';
import { upsertCdnSite, getCdnSite } from './sites.js';
import {
  renderCdnEdgeNginxConf,
  applyCdnSiteEdgeRender,
  readCdnSiteRenderedConf,
} from './edge-render.js';
import type { CdnSiteDto } from '@yanshekki/shared';

function baseSite(over: Partial<CdnSiteDto> = {}): CdnSiteDto {
  return {
    id: 'site-edge-1',
    name: 'edge',
    domains: ['cdn.example.com'],
    mode: 'origin_pull',
    origin: { kind: 'url', url: 'https://origin.example.com' },
    edgeNodeIds: ['e1'],
    dns: {
      strategy: 'multi_a',
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
    ssl: { mode: 'off' },
    apply_status: 'draft',
    edge_status: {},
    ...over,
  };
}

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

describe('edge-render pure + apply', () => {
  it('throws without domains', () => {
    expect(() =>
      renderCdnEdgeNginxConf({ site: baseSite({ domains: [] }) }),
    ).toThrow();
  });

  it('renders SSL + ACME only modes', () => {
    const ssl = renderCdnEdgeNginxConf({
      site: baseSite({
        ssl: { mode: 'le_http01' },
        mode: 'static_edge',
      }),
      sslPaths: {
        fullchain: '/etc/ssl/cdn/fullchain.pem',
        privkey: '/etc/ssl/cdn/privkey.pem',
        acmeWebroot: '/var/www/acme',
        redirectHttp: true,
      },
    });
    expect(ssl.sslEnabled).toBe(true);
    expect(ssl.conf).toMatch(/ssl_certificate|listen 443/);
    expect(ssl.conf).toContain('proxy_cache');

    const acme = renderCdnEdgeNginxConf({
      site: baseSite({ ssl: { mode: 'le_http01' } }),
      acmeOnly: true,
      sslPaths: {
        fullchain: '/x',
        privkey: '/y',
      },
    });
    expect(acme.sslEnabled).toBe(false);
    expect(acme.conf).toContain('acme-challenge');
    expect(acme.conf).toContain('ysk-cdn-ok');
  });

  it('uses project origin and shield upstream notes', () => {
    const proj = renderCdnEdgeNginxConf({
      site: baseSite({
        origin: { kind: 'project', projectId: 'proj-1' },
      }),
      projectOriginUrl: 'http://127.0.0.1:9080',
    });
    expect(proj.originUpstream).toBe('http://127.0.0.1:9080');

    const shield = renderCdnEdgeNginxConf({
      site: baseSite({
        originShieldNodeId: 'shield-node',
      }),
      shieldUpstreamUrl: 'http://10.0.0.5:80',
      isShieldEdge: false,
    });
    expect(shield.originUpstream).toBe('http://10.0.0.5:80');

    const asShield = renderCdnEdgeNginxConf({
      site: baseSite({
        originShieldNodeId: 'shield-node',
        origin: { kind: 'url', url: 'https://real-origin.example' },
      }),
      isShieldEdge: true,
    });
    expect(asShield.originUpstream).toContain('real-origin.example');
  });

  it('cache off and sni block', () => {
    const r = renderCdnEdgeNginxConf({
      site: baseSite({
        cache: {
          enabled: false,
          zoneSize: '1m',
          maxAge: '1m',
          bypassCookies: false,
          bypassAuth: false,
        },
        origin: {
          kind: 'url',
          url: 'https://origin.example.com',
          sni: 'origin.example.com',
        },
        mode: 'reverse_proxy',
      }),
    });
    expect(r.conf).toContain('X-YSK-Cache BYPASS');
    expect(r.conf).toContain('proxy_ssl_server_name on');
  });

  it('apply writes conf, meta, and readCdnSiteRenderedConf', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-er-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'e1',
        roles: ['edge'],
        publicIpv4: ['203.0.113.50'],
      });
      const site = upsertCdnSite(db, {
        name: 's1',
        domains: ['edge.test'],
        origin: { kind: 'url', url: 'https://o.example' },
        edgeNodeIds: [edge.id],
        mode: 'origin_pull',
      });

      const host: HostExecutor = {
        pathExists: (p) => p === '/usr/sbin/nginx',
        isRoot: () => false,
        executeEnabled: () => true,
        readFile: async () => '',
        listDir: async () => [],
        writeFile: async () => {},
        deletePath: async () => {},
        mkdirp: async () => {},
        sysInfo: async () => ({}),
        serviceStatus: async () => empty(),
        runCommand: async (argv) => {
          if (argv[0] === 'nginx') {
            return { ...empty(), exitCode: 0, stdout: 'syntax ok\n', argv };
          }
          return { ...empty(), argv };
        },
      };

      const applied = await applyCdnSiteEdgeRender({
        db,
        dataDir: dir,
        siteId: site.id,
        host,
        dryRun: false,
        sslPaths: {
          fullchain: '/etc/ssl/c.pem',
          privkey: '/etc/ssl/k.pem',
        },
      });
      expect(applied.ok).toBe(true);
      expect(applied.apply_status).toBe('written');
      expect(existsSync(applied.confPath)).toBe(true);
      expect(applied.written.length).toBeGreaterThan(1);
      expect(getCdnSite(db, site.id)?.apply_status).toBe('written');

      const read = readCdnSiteRenderedConf(dir, site.id);
      expect(read?.conf).toContain('edge.test');
      expect(read?.meta?.siteId).toBe(site.id);
      expect(readCdnSiteRenderedConf(dir, 'missing')).toBeNull();

      // corrupt meta still returns conf
      const metaPath = join(dir, 'cdn', 'sites', site.id, 'meta.json');
      writeFileSync(metaPath, '{bad', 'utf8');
      const again = readCdnSiteRenderedConf(dir, site.id);
      expect(again?.conf).toBeTruthy();
      expect(again?.meta).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('apply dry-run and missing site', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-er-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'e2',
        roles: ['edge'],
        publicIpv4: ['203.0.113.51'],
      });
      const site = upsertCdnSite(db, {
        name: 's2',
        domains: ['dry.example'],
        origin: { kind: 'url', url: 'http://127.0.0.1:1' },
        edgeNodeIds: [edge.id],
      });
      const dry = await applyCdnSiteEdgeRender({
        db,
        dataDir: dir,
        siteId: site.id,
        dryRun: true,
        copyToNginxManaged: false,
      });
      expect(dry.apply_status).toBe('planned');
      expect(dry.written).toEqual([]);
      expect(dry.confPath).toBe('');

      await expect(
        applyCdnSiteEdgeRender({
          db,
          dataDir: dir,
          siteId: 'no-such-site',
        }),
      ).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
