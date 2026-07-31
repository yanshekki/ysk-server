import { describe, expect, it, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  geoipDir,
  metaPath,
  loadGeoipMeta,
  saveGeoipMeta,
  listGeoipSourceStatus,
  updateGeoipDatabases,
} from './downloader.js';
import { resolveGeoipSources, sapicsSources, dbipCityLiteSources, ipinfoLiteSource } from './providers.js';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe('geoip downloader pure helpers', () => {
  it('geoipDir metaPath load/save round-trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-gdl-'));
    dirs.push(dir);
    expect(geoipDir(dir)).toBe(join(dir, 'geoip'));
    expect(metaPath(dir)).toBe(join(dir, 'geoip', 'meta.json'));
    expect(loadGeoipMeta(dir)).toBeNull();
    saveGeoipMeta(dir, {
      provider: 'sapics',
      files: [{ filename: 'user-country.mmdb', url: 'http://x', downloadedAt: 't', bytes: 10, ok: true }],
      lastAttemptAt: 't',
    });
    const m = loadGeoipMeta(dir);
    expect(m?.provider).toBe('sapics');
    expect(m?.files[0].filename).toBe('user-country.mmdb');
    // corrupt
    writeFileSync(metaPath(dir), 'nope', 'utf8');
    expect(loadGeoipMeta(dir)).toBeNull();
  });

  it('listGeoipSourceStatus redacts tokens and reports presence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-gdl2-'));
    dirs.push(dir);
    const gdir = geoipDir(dir);
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'user-country.mmdb'), 'x'.repeat(2048), 'utf8');
    const st = listGeoipSourceStatus(dir, {
      YSK_GEOIP_PROFILE: 'country_asn',
      IPINFO_TOKEN: 'secret-token',
    } as NodeJS.ProcessEnv);
    expect(st.provider).toMatch(/sapics/);
    const country = st.sources.find((s) => s.filename === 'user-country.mmdb');
    expect(country?.present).toBe(true);
    expect(country?.bytes).toBeGreaterThan(1000);
    const lite = st.sources.find((s) => s.filename === 'ipinfo_lite.mmdb');
    if (lite) {
      expect(lite.url).not.toContain('secret-token');
      expect(lite.url).toContain('token=***');
    }
  });

  it('providers resolve profiles and optional token', () => {
    const sap = sapicsSources();
    expect(sap).toHaveLength(2);
    const city = dbipCityLiteSources({});
    expect(city[0].filename).toBe('dbip-city-lite.mmdb');
    expect(city[0].gzip).toBe(true);
    const info = ipinfoLiteSource('abc');
    expect(info.url).toContain('token=abc');
    const full = resolveGeoipSources({ YSK_GEOIP_PROFILE: 'city_lite' } as NodeJS.ProcessEnv);
    expect(full.provider).toBe('sapics+dbip');
    const countryOnly = resolveGeoipSources({
      YSK_GEOIP_PROFILE: 'country_asn',
    } as NodeJS.ProcessEnv);
    expect(countryOnly.provider).toBe('sapics');
    expect(countryOnly.sources.every((s) => s.kind !== 'city')).toBe(true);
  });

  it('updateGeoipDatabases fail-soft keeps notes when fetch fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-gdl3-'));
    dirs.push(dir);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        body: null,
        headers: { get: () => null },
      })),
    );
    const r = await updateGeoipDatabases(dir, {
      YSK_GEOIP_PROFILE: 'country_asn',
    } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.meta.lastError || r.meta.files.some((f) => !f.ok)).toBeTruthy();
    expect(existsSync(metaPath(dir))).toBe(true);
    const meta = JSON.parse(readFileSync(metaPath(dir), 'utf8'));
    expect(meta.provider).toMatch(/sapics/);
  });

  it('updateGeoipDatabases succeeds when fetch returns enough bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-gdl4-'));
    dirs.push(dir);
    const payload = Buffer.alloc(2048, 7);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(payload);
            controller.close();
          },
        }),
        headers: {
          get: (k: string) => (k.toLowerCase() === 'etag' ? '"abc"' : null),
        },
      })),
    );
    const r = await updateGeoipDatabases(dir, {
      YSK_GEOIP_PROFILE: 'country_asn',
    } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    expect(r.meta.files.some((f) => f.ok)).toBe(true);
    expect(existsSync(join(geoipDir(dir), 'user-country.mmdb'))).toBe(true);
  });
});
