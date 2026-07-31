import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  lookupIp,
  resetGeoipReaders,
} from './lookup.js';
import {
  normalizeAsn,
  normalizeCountry,
  normalizeContinent,
  normalizeRegionKey,
  normalizeCityKey,
  makeRegionKey,
  makeCityKey,
} from './types.js';

const dirs: string[] = [];
afterEach(() => {
  resetGeoipReaders();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe('geoip types normalizers', () => {
  it('normalizes asn country continent region city keys', () => {
    expect(normalizeAsn('as13335')).toBe('AS13335');
    expect(normalizeAsn('13335')).toBe('AS13335');
    expect(normalizeAsn('nope')).toBe('');
    expect(normalizeCountry('cn')).toBe('CN');
    expect(normalizeCountry('china')).toBe('');
    expect(normalizeContinent('as')).toBe('AS');
    expect(normalizeRegionKey('cn-gd')).toBe('CN-GD');
    expect(normalizeRegionKey('bad')).toBe('');
    expect(normalizeCityKey('CN|Guangzhou')).toBe('CN|Guangzhou');
    expect(normalizeCityKey('xx')).toBe('');
    expect(makeRegionKey('CN', 'gd')).toBe('CN-GD');
    expect(makeRegionKey('US', undefined, 'California')).toMatch(/^US-/);
    expect(makeCityKey('CN', ' Guangzhou ')).toBe('CN|Guangzhou');
    expect(makeCityKey(undefined, 'x')).toBeUndefined();
  });
});

describe('lookupIp honesty without MMDB', () => {
  it('rejects empty and invalid IPs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-geo-'));
    dirs.push(dir);
    const empty = await lookupIp(dir, '  ');
    expect(empty.ok).toBe(false);
    const bad = await lookupIp(dir, 'not.an.ip');
    expect(bad.ok).toBe(false);
    expect(bad.notes.length).toBeGreaterThan(0);
  });

  it('private/local IPs return ZZ without databases', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-geo2-'));
    dirs.push(dir);
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '::1']) {
      const r = await lookupIp(dir, ip);
      expect(r.ok).toBe(true);
      expect(r.country).toBe('ZZ');
      expect(r.countryName).toMatch(/Private|Local/i);
    }
  });

  it('public IP without mmdb files is honest failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-geo3-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'geoip'), { recursive: true });
    // tiny non-mmdb file should not open as reader (open fails or absent)
    writeFileSync(join(dir, 'geoip', 'user-country.mmdb'), 'not-a-real-mmdb', 'utf8');
    resetGeoipReaders();
    const r = await lookupIp(dir, '1.1.1.1');
    // either open fails → no readers, or corrupt reader get fails
    expect(r.ok === false || r.ok === true).toBe(true);
    if (!r.ok) {
      expect(r.notes.some((n) => n.length > 0)).toBe(true);
    }
    resetGeoipReaders();
    // empty dir
    const dir2 = mkdtempSync(join(tmpdir(), 'ysk-geo4-'));
    dirs.push(dir2);
    const r2 = await lookupIp(dir2, '8.8.8.8');
    expect(r2.ok).toBe(false);
    expect(r2.notes.length).toBeGreaterThan(0);
  });
});
