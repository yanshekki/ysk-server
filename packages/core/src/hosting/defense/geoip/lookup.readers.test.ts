import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const openMock = vi.fn();

vi.mock('maxmind', () => ({
  default: {
    open: (...args: unknown[]) => openMock(...args),
  },
}));

import { lookupIp, resetGeoipReaders } from './lookup.js';

const dirs: string[] = [];
afterEach(() => {
  resetGeoipReaders();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
  openMock.mockReset();
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ysk-geo-rd-'));
  dirs.push(d);
  return d;
}

function reader(get: (ip: string) => unknown) {
  return { get };
}

describe('lookupIp with mocked MMDB readers', () => {
  it('parses city-style + lite + country + asn records', async () => {
    const dataDir = tmp();
    const gdir = join(dataDir, 'geoip');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'dbip-city-lite.mmdb'), 'city');
    writeFileSync(join(gdir, 'ipinfo_lite.mmdb'), 'lite');
    writeFileSync(join(gdir, 'user-country.mmdb'), 'country');
    writeFileSync(join(gdir, 'origin-asn.mmdb'), 'asn');

    openMock.mockImplementation(async (path: string) => {
      if (path.includes('dbip-city')) {
        return reader(() => ({
          country: { iso_code: 'us', names: { en: 'United States', 'zh-CN': '美国' } },
          continent: { code: 'na', names: { en: 'North America' } },
          city: { names: { en: 'New York' } },
          subdivisions: [{ iso_code: 'ny', names: { en: 'New York' } }],
          location: { latitude: 40.7, longitude: -74.0 },
          accuracy_radius: 50,
        }));
      }
      if (path.includes('ipinfo_lite')) {
        return reader(() => ({
          country_code: 'US',
          country_name: 'United States',
          continent_code: 'NA',
          continent_name: 'North America',
          asn: 'AS13335',
          as_name: 'Cloudflare',
          as_domain: 'cloudflare.com',
        }));
      }
      if (path.includes('user-country')) {
        return reader(() => ({ country_code: 'DE' }));
      }
      if (path.includes('origin-asn')) {
        return reader(() => ({
          autonomous_system_number: 15169,
          autonomous_system_organization: 'Google',
        }));
      }
      return reader(() => null);
    });

    const r = await lookupIp(dataDir, '1.1.1.1');
    expect(r.ok).toBe(true);
    expect(r.country).toBe('US');
    expect(r.countryName).toMatch(/United/);
    expect(r.continent).toBe('NA');
    expect(r.regionCode).toBe('NY');
    expect(r.city).toBe('New York');
    expect(r.cityKey).toBe('US|New York');
    expect(r.regionKey).toMatch(/^US-/);
    expect(r.latitude).toBe(40.7);
    expect(r.longitude).toBe(-74);
    expect(r.asn).toBe('AS13335');
    expect(r.asName).toMatch(/Cloudflare/);
    expect(r.confidenceHint).toBe('city');
    expect(r.source).toBeTruthy();

    // second call hits openReaders cache
    const r2 = await lookupIp(dataDir, '1.0.0.1');
    expect(r2.ok).toBe(true);
    expect(openMock.mock.calls.length).toBe(4);
  });

  it('falls back to country/asn readers when city empty; region confidence', async () => {
    const dataDir = tmp();
    const gdir = join(dataDir, 'geoip');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'user-country.mmdb'), 'c');
    writeFileSync(join(gdir, 'origin-asn.mmdb'), 'a');

    openMock.mockImplementation(async (path: string) => {
      if (path.includes('user-country')) {
        return reader(() => ({ iso_code: 'JP' }));
      }
      if (path.includes('origin-asn')) {
        return reader(() => ({ asn: 'AS2516', as_org: 'KDDI' }));
      }
      throw new Error('should not open');
    });

    // only country+asn files exist — open only those
    openMock.mockImplementation(async (path: string) => {
      if (path.includes('user-country')) {
        return reader(() => ({ country: 'jp' }));
      }
      if (path.includes('origin-asn')) {
        return reader(() => ({
          as_number: '2516',
          name: 'KDDI',
        }));
      }
      return reader(() => null);
    });

    // Files don't exist for lite/city so open isn't called for them —
    // ensure files that exist
    const r = await lookupIp(dataDir, '8.8.8.8');
    expect(r.ok).toBe(true);
    expect(r.country).toBe('JP');
    expect(r.asn).toBe('AS2516');
    expect(r.notes.some((n) => n.length > 0)).toBe(true); // no city db note
  });

  it('returns ok:false when reader throws; handles empty record', async () => {
    const dataDir = tmp();
    const gdir = join(dataDir, 'geoip');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'ipinfo_lite.mmdb'), 'lite');

    openMock.mockImplementation(async () =>
      reader(() => {
        throw new Error('corrupt mmdb');
      }),
    );
    const bad = await lookupIp(dataDir, '9.9.9.9');
    expect(bad.ok).toBe(false);
    expect(bad.notes.some((n) => /corrupt/.test(n))).toBe(true);

    resetGeoipReaders();
    openMock.mockImplementation(async () => reader(() => null));
    const empty = await lookupIp(dataDir, '9.9.9.9');
    expect(empty.ok).toBe(false);

    // open fails entirely
    resetGeoipReaders();
    openMock.mockRejectedValue(new Error('open fail'));
    const noOpen = await lookupIp(dataDir, '9.9.9.9');
    expect(noOpen.ok).toBe(false);
  });

  it('pickStr nested iso_code / nameEn zh-CN and pickNum nested location', async () => {
    const dataDir = tmp();
    const gdir = join(dataDir, 'geoip');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'ipinfo_lite.mmdb'), 'lite');
    writeFileSync(join(gdir, 'dbip-city-lite.mmdb'), 'city');

    openMock.mockImplementation(async (path: string) => {
      if (path.includes('dbip-city')) {
        return reader(() => ({
          country: { names: { 'zh-CN': '  中国  ' } },
          continent: {},
          // force pickStr country_code path via top-level
          country_code: 'CN',
          stateprov: 'Guangdong',
          stateprov_code: 'gd',
          city_name: 'Shenzhen',
          lat: 22.5,
          lon: 114.0,
        }));
      }
      if (path.includes('ipinfo')) {
        return reader(() => ({
          country: { iso_code: 'CN' },
          latitude: { latitude: 22.5 },
        }));
      }
      return reader(() => null);
    });

    const r = await lookupIp(dataDir, '114.114.114.114');
    expect(r.ok).toBe(true);
    expect(r.country).toBe('CN');
    expect(r.regionName || r.city).toBeTruthy();
  });

  it('country reader string record and first A-Z value fallback', async () => {
    const dataDir = tmp();
    const gdir = join(dataDir, 'geoip');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'user-country.mmdb'), 'c');

    openMock.mockImplementation(async () => reader(() => ({ x: 1, code: 'FR' })));
    const r = await lookupIp(dataDir, '1.2.3.4');
    expect(r.ok).toBe(true);
    expect(r.country).toBe('FR');
    expect(r.confidenceHint).toBe('country');
  });

  it('region confidence when region without city', async () => {
    const dataDir = tmp();
    const gdir = join(dataDir, 'geoip');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'dbip-city-lite.mmdb'), 'city');

    openMock.mockImplementation(async () =>
      reader(() => ({
        country: { iso_code: 'AU' },
        subdivisions: [{ iso_code: 'NSW', names: { en: 'New South Wales' } }],
      })),
    );
    const r = await lookupIp(dataDir, '1.2.3.4');
    expect(r.ok).toBe(true);
    expect(r.confidenceHint).toBe('region');
    expect(r.regionKey).toMatch(/^AU-/);
  });
});
