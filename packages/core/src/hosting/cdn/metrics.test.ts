import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import { upsertCdnNode } from './nodes.js';
import { upsertCdnSite } from './sites.js';
import {
  collectCdnDashboard,
  estimateSiteCacheHitRate,
} from './metrics.js';

describe('cdn metrics (PR-C5)', () => {
  it('collects dashboard node/site counts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnmet-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const e1 = upsertCdnNode(db, {
        name: 'e1',
        roles: ['edge'],
        publicIpv4: ['203.0.113.1'],
        status: 'online',
        region: 'hkg',
      });
      upsertCdnNode(db, {
        name: 'e2',
        roles: ['edge'],
        publicIpv4: ['203.0.113.2'],
        status: 'offline',
        region: 'hkg',
      });
      upsertCdnSite(db, {
        name: 'site-a',
        domains: ['a.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [e1.id],
      });

      const dash = await collectCdnDashboard({ db, dataDir: dir });
      expect(dash.nodes.total).toBe(2);
      expect(dash.nodes.online).toBe(1);
      expect(dash.nodes.offline).toBe(1);
      expect(dash.nodes.byRegion.hkg).toBe(2);
      expect(dash.sites.total).toBe(1);
      expect(dash.sites.rows[0].name).toBe('site-a');
      expect(dash.notes.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses HIT/MISS from access log sample', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnmet-'));
    try {
      const logDir = join(dir, 'logs');
      mkdirSync(logDir, { recursive: true });
      const logPath = join(logDir, 'nginx-access.log');
      writeFileSync(
        logPath,
        [
          'x HIT y',
          'x MISS y',
          'x HIT y',
          'x BYPASS y',
          'x HIT y',
        ].join('\n'),
        'utf8',
      );

      const db = new JsonStore(join(dir, 'db.json'));
      const e1 = upsertCdnNode(db, {
        name: 'e1',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 's',
        domains: ['s.example.com'],
        origin: { kind: 'url', url: 'http://127.0.0.1:9' },
        edgeNodeIds: [e1.id],
      });

      const est = await estimateSiteCacheHitRate({
        site,
        dataDir: dir,
        accessLogPath: logPath,
      });
      expect(est.method).toBe('access_log');
      expect(est.hits).toBe(3);
      expect(est.misses).toBe(1);
      expect(est.hitRatePct).toBe(75);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
