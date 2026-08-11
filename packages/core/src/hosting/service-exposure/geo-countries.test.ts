import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  normalizeCountries,
  ipsetNameForService,
  readCountryZoneCidrs,
  countryZonePath,
} from './geo-countries.js';

describe('geo-countries', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-geo-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('normalizes ISO country codes', () => {
    expect(normalizeCountries(['hk', 'CN', 'xx', 'HK', '1', 'USA'])).toEqual([
      'HK',
      'CN',
      'XX',
    ]);
  });

  it('builds safe ipset names', () => {
    expect(ipsetNameForService('nginx')).toMatch(/^yskgeo_/);
    expect(ipsetNameForService('MySQL!!')).toMatch(/^yskgeo_/);
  });

  it('reads zone CIDRs', () => {
    const zdir = join(dir, 'geoip', 'country-zones');
    mkdirSync(zdir, { recursive: true });
    writeFileSync(countryZonePath(dir, 'hk'), '# c\n1.2.3.0/24\n\n5.6.7.8\n', 'utf8');
    expect(readCountryZoneCidrs(dir, 'HK')).toEqual(['1.2.3.0/24', '5.6.7.8']);
  });
});
