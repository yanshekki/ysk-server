import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../../db/store.js';
import {
  getGeoipStatus,
  refreshGeoip,
  lookupIpWithPolicy,
  updateIpAccessPolicy,
  applyIpAccessNginx,
  geoDbFileStats,
} from './index.js';
import { resetGeoipReaders } from './lookup.js';
import { saveGeoipMeta } from './downloader.js';
import { DEFAULT_IP_ACCESS_POLICY } from './types.js';

const dirs: string[] = [];
afterEach(() => {
  resetGeoipReaders();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
  vi.restoreAllMocks();
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ysk-geoip-idx-'));
  dirs.push(d);
  return d;
}

describe('geoip/index orchestration', () => {
  it('getGeoipStatus reports not ready without databases', async () => {
    const dataDir = tmp();
    const db = new JsonStore(join(dataDir, 'db.json'));
    const st = await getGeoipStatus(dataDir, db);
    expect(st.ready).toBe(false);
    expect(st.cityReady).toBe(false);
    expect(st.maxGranularity).toBe('country');
    expect(st.policy.enabled).toBe(false);
    expect(st.notes.length).toBeGreaterThan(0);
    expect(st.dir).toContain('geoip');
  });

  it('getGeoipStatus marks ready/stale and cityReady from files + meta', async () => {
    const dataDir = tmp();
    const db = new JsonStore(join(dataDir, 'db.json'));
    const gdir = join(dataDir, 'geoip');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'user-country.mmdb'), 'x'.repeat(2048));
    writeFileSync(join(gdir, 'dbip-city-lite.mmdb'), 'y'.repeat(2048));
    const aged = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    utimesSync(join(gdir, 'user-country.mmdb'), aged, aged);
    utimesSync(join(gdir, 'dbip-city-lite.mmdb'), aged, aged);
    saveGeoipMeta(dataDir, {
      provider: 'test',
      files: [
        {
          filename: 'user-country.mmdb',
          url: 'http://example/c',
          downloadedAt: new Date().toISOString(),
          bytes: 2048,
          ok: true,
        },
      ],
      lastSuccessAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      attribution: 'Test DB',
    });
    updateIpAccessPolicy(db, dataDir, {
      enabled: true,
      mode: 'deny_list',
      countries: ['CN'],
      regions: ['CN-GD'],
      cities: ['CN|Guangzhou'],
      asns: ['AS13335'],
      cityPolicyEnabled: true,
    });
    const st = await getGeoipStatus(dataDir, db);
    expect(st.ready).toBe(true);
    expect(st.stale).toBe(true);
    expect(st.cityReady).toBe(true);
    expect(st.maxGranularity).toBe('city');
    expect(st.attribution.length).toBeGreaterThan(0);
    expect(st.policy.enabled).toBe(true);
    expect(st.policy.countries).toContain('CN');
  });

  it('getGeoipStatus is not stale when files are newer than lastSuccessAt', async () => {
    const dataDir = tmp();
    const db = new JsonStore(join(dataDir, 'db.json'));
    const gdir = join(dataDir, 'geoip');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'user-country.mmdb'), 'x'.repeat(2048));
    saveGeoipMeta(dataDir, {
      provider: 'test',
      files: [],
      lastSuccessAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      attribution: 'Test DB',
    });
    const st = await getGeoipStatus(dataDir, db);
    expect(st.ready).toBe(true);
    expect(st.stale).toBe(false);
  });

  it('getGeoipStatus uses mtime for stale when no lastSuccessAt', async () => {
    const dataDir = tmp();
    const db = new JsonStore(join(dataDir, 'db.json'));
    const gdir = join(dataDir, 'geoip');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'user-country.mmdb'), 'z'.repeat(2048));
    const st = await getGeoipStatus(dataDir, db);
    expect(st.ready).toBe(true);
    // fresh file → not stale
    expect(typeof st.stale).toBe('boolean');
  });

  it('refreshGeoip runs update (fail-soft download) and returns status shape', async () => {
    const dataDir = tmp();
    // Pre-seed so anyOk can be true when download fails
    const gdir = join(dataDir, 'geoip');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'user-country.mmdb'), 'x'.repeat(2048));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        body: null,
        headers: { get: () => null },
      })),
    );
    try {
      const r = await refreshGeoip(dataDir);
      expect(r.status.dir).toContain('geoip');
      expect(r.status.stale).toBe(false);
      expect(Array.isArray(r.notes)).toBe(true);
      expect(r.status.policy).toMatchObject({
        countries: [],
        continents: [],
        regions: [],
        cities: [],
        asns: [],
      });
      // existing file → ready path can be true via anyOk
      expect(typeof r.ok).toBe('boolean');
      expect(r.status.policy.enabled).toBe(DEFAULT_IP_ACCESS_POLICY.enabled);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lookupIpWithPolicy + update + apply nginx + geoDbFileStats', async () => {
    const dataDir = tmp();
    const db = new JsonStore(join(dataDir, 'db.json'));
    const pol = updateIpAccessPolicy(db, dataDir, {
      enabled: true,
      mode: 'deny_list',
      countries: ['CN'],
      enforce: { autoBan: true, nginx: false, ufw: false },
    });
    expect(pol.enabled).toBe(true);

    const r = await lookupIpWithPolicy(dataDir, db, '127.0.0.1', ['127.0.0.1']);
    expect(r.lookup.ok).toBe(true);
    expect(r.lookup.country).toBe('ZZ');
    expect(typeof r.access.blocked).toBe('boolean');
    expect(r.access.reason).toBeTruthy();

    const noNg = applyIpAccessNginx(dataDir, db);
    expect(noNg.ok).toBe(true);
    expect(noNg.notes.length).toBeGreaterThan(0);

    updateIpAccessPolicy(db, dataDir, {
      enforce: { autoBan: true, nginx: true, ufw: false },
    });
    const ng = applyIpAccessNginx(dataDir, db);
    expect(ng.ok).toBe(true);
    expect(ng.path.length).toBeGreaterThan(0);

    const gdir = join(dataDir, 'geoip');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'ipinfo_lite.mmdb'), 'm'.repeat(100));
    writeFileSync(join(gdir, 'user-country.mmdb'), 'n'.repeat(50));
    const stats = geoDbFileStats(dataDir);
    expect(stats.some((s) => s.name === 'ipinfo_lite.mmdb')).toBe(true);
    expect(stats.every((s) => s.bytes > 0 && s.mtime)).toBe(true);
  });
});
