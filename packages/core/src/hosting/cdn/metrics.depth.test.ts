import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { estimateSiteCacheHitRate, collectCdnDashboard } from './metrics.js';
import { upsertCdnNode } from './nodes.js';
import { upsertCdnSite } from './sites.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts: {
  execute?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute ?? false,
    isRoot: () => false,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({
      ...empty(),
      argv,
      ...(opts.run?.(argv) ?? {}),
    }),
  };
}

function siteStub(id: string, name = id): import('@ysk-server/shared').CdnSiteDto {
  return {
    id,
    name,
    domains: [`${id}.example.com`],
    mode: 'proxy',
    origin: { kind: 'url', url: 'http://origin' },
    edgeNodeIds: [],
    apply_status: 'written',
    dns: { strategy: 'multi_a' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as never;
}

describe('cdn metrics depth', () => {
  it('estimateSiteCacheHitRate reads local access log without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdn-m-'));
    try {
      const log = join(dir, 'logs', 'nginx-access.log');
      mkdirSync(join(dir, 'logs'), { recursive: true });
      writeFileSync(
        log,
        'HIT MISS HIT BYPASS HIT EXPIRED STALE\n'.repeat(20),
        'utf8',
      );
      const est = await estimateSiteCacheHitRate({
        site: siteStub('s1'),
        dataDir: dir,
      });
      expect(est.method).toBe('access_log');
      expect(est.sampleLines).toBeGreaterThan(0);
      expect(est.hitRatePct).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('estimateSiteCacheHitRate uses host tail when execute enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdn-m2-'));
    try {
      const est = await estimateSiteCacheHitRate({
        site: siteStub('s2'),
        dataDir: dir,
        host: mockHost({
          execute: true,
          run: () => ({
            exitCode: 0,
            stdout: 'HIT\nHIT\nMISS\nMISS\nBYPASS\n',
          }),
        }),
      });
      expect(est.method).toBe('access_log');
      expect(est.hits).toBe(2);
      expect(est.misses).toBe(2);
      expect(est.hitRatePct).toBe(50);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('estimateSiteCacheHitRate cache_dir fallback under dataDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdn-m3-'));
    try {
      const cache = join(dir, 'cdn', 'cache-stats', 's3');
      mkdirSync(cache, { recursive: true });
      writeFileSync(join(cache, 'a.bin'), Buffer.alloc(100));
      mkdirSync(join(cache, 'sub'), { recursive: true });
      writeFileSync(join(cache, 'sub', 'b.bin'), Buffer.alloc(50));
      const est = await estimateSiteCacheHitRate({
        site: siteStub('s3'),
        dataDir: dir,
      });
      expect(est.method).toBe('cache_dir');
      expect(est.cacheBytes).toBeGreaterThanOrEqual(150);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('estimateSiteCacheHitRate method none when no data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdn-m4-'));
    try {
      const est = await estimateSiteCacheHitRate({
        site: siteStub('empty'),
        dataDir: dir,
      });
      expect(est.method).toBe('none');
      expect(est.notes.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('collectCdnDashboard aggregates nodes/sites and overall hit rate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdn-m5-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const n1 = upsertCdnNode(db, {
        name: 'e1',
        roles: ['edge'],
        publicIpv4: ['1.1.1.1'],
        region: 'hk',
        status: 'online',
      });
      const n2 = upsertCdnNode(db, {
        name: 'e2',
        roles: ['edge'],
        publicIpv4: ['2.2.2.2'],
        region: 'sg',
        status: 'offline',
      });
      upsertCdnNode(db, {
        name: 'e3',
        roles: ['edge'],
        publicIpv4: ['3.3.3.3'],
        status: 'draining',
      });

      // create many sites to exercise maxCacheSamples note
      const log = join(dir, 'logs', 'nginx-access.log');
      mkdirSync(join(dir, 'logs'), { recursive: true });
      writeFileSync(log, 'HIT MISS HIT\n'.repeat(5), 'utf8');
      for (let i = 0; i < 12; i++) {
        upsertCdnSite(db, {
          name: `site${i}`,
          domains: [`s${i}.example.com`],
          origin: { kind: 'url', url: 'http://o' },
          edgeNodeIds: i === 0 ? [n1.id, n2.id] : [n1.id],
        });
      }

      const dash = await collectCdnDashboard({
        db,
        dataDir: dir,
        maxCacheSamples: 3,
        host: mockHost({ execute: false }),
      });
      expect(dash.nodes.total).toBeGreaterThanOrEqual(3);
      expect(dash.nodes.online).toBeGreaterThanOrEqual(1);
      expect(dash.nodes.byRegion.hk).toBe(1);
      expect(dash.sites.total).toBeGreaterThanOrEqual(12);
      expect(dash.cache.length).toBe(3);
      expect(dash.notes.length).toBeGreaterThan(0);
      if (dash.overallHitRatePct != null) {
        expect(dash.overallHitRatePct).toBeGreaterThanOrEqual(0);
      }
      expect(dash.sites.rows.some((r) => r.edgeCount > 0)).toBe(true);
      expect(dash.sites.rows[0]?.onlineEdges).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
