import { tl } from '@yanshekki/shared';
/**
 * Offline MMDB lookup — sapics / IPinfo Lite / DB-IP City Lite.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import maxmind, { type Reader } from 'maxmind';
import { isPrivateOrLocalIp, isValidIp, normalizeIp } from '../../../net/ip.js';
import { geoipDir, listGeoipSourceStatus } from './downloader.js';
import { makeCityKey, makeRegionKey, normalizeAsn } from './types.js';
import type { GeoLookupResult } from './types.js';

type AnyRec = Record<string, unknown>;

let countryReader: Reader<AnyRec> | null = null;
let asnReader: Reader<AnyRec> | null = null;
let liteReader: Reader<AnyRec> | null = null;
let cityReader: Reader<AnyRec> | null = null;
let openedDir: string | null = null;

function nameEn(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as AnyRec;
  const names = o.names as AnyRec | undefined;
  if (names) {
    if (typeof names.en === 'string' && names.en.trim()) return names.en.trim();
    if (typeof names['zh-CN'] === 'string' && names['zh-CN'].trim())
      return String(names['zh-CN']).trim();
  }
  return undefined;
}

function pickStr(obj: AnyRec | null | undefined, keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (v && typeof v === 'object') {
      const o = v as AnyRec;
      if (typeof o.iso_code === 'string') return o.iso_code;
      if (typeof o.code === 'string') return o.code;
      const n = nameEn(o);
      if (n) return n;
    }
  }
  return undefined;
}

function pickNum(obj: AnyRec | null | undefined, keys: string[]): number | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
    // nested location: { latitude, longitude }
    if (v && typeof v === 'object') {
      const o = v as AnyRec;
      if (k === 'location' || k === 'latitude' || k === 'longitude') {
        /* handled below */
      }
      if (typeof o.latitude === 'number' && keys.includes('latitude')) return o.latitude;
      if (typeof o.longitude === 'number' && keys.includes('longitude')) return o.longitude;
    }
  }
  return undefined;
}

/** MaxMind / DB-IP nested city record */
function parseCityStyleRecord(rec: AnyRec): {
  country?: string;
  countryName?: string;
  continent?: string;
  continentName?: string;
  regionCode?: string;
  regionName?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
} {
  const countryObj = rec.country as AnyRec | undefined;
  const contObj = rec.continent as AnyRec | undefined;
  const cityObj = rec.city as AnyRec | undefined;
  const loc = rec.location as AnyRec | undefined;
  const subs = rec.subdivisions as AnyRec[] | undefined;
  const sub0 = Array.isArray(subs) && subs[0] ? (subs[0] as AnyRec) : undefined;

  return {
    country:
      (typeof countryObj?.iso_code === 'string' ? countryObj.iso_code : undefined) ||
      pickStr(rec, ['country_code', 'country']),
    countryName: nameEn(countryObj) || pickStr(rec, ['country_name']),
    continent:
      (typeof contObj?.code === 'string' ? contObj.code : undefined) ||
      pickStr(rec, ['continent_code', 'continent']),
    continentName: nameEn(contObj),
    regionCode:
      (typeof sub0?.iso_code === 'string' ? sub0.iso_code : undefined) ||
      pickStr(rec, ['stateprov_code', 'region_code']),
    regionName:
      nameEn(sub0) ||
      pickStr(rec, ['stateprov', 'region', 'state', 'province']),
    city: nameEn(cityObj) || pickStr(rec, ['city', 'city_name']),
    latitude:
      typeof loc?.latitude === 'number'
        ? loc.latitude
        : pickNum(rec, ['latitude', 'lat']),
    longitude:
      typeof loc?.longitude === 'number'
        ? loc.longitude
        : pickNum(rec, ['longitude', 'lon', 'lng']) };
}

async function openReaders(dataDir: string): Promise<void> {
  const dir = geoipDir(dataDir);
  if (
    openedDir === dir &&
    (liteReader || countryReader || asnReader || cityReader)
  ) {
    return;
  }

  countryReader = null;
  asnReader = null;
  liteReader = null;
  cityReader = null;
  openedDir = dir;

  const paths = {
    lite: join(dir, 'ipinfo_lite.mmdb'),
    country: join(dir, 'user-country.mmdb'),
    asn: join(dir, 'origin-asn.mmdb'),
    city: join(dir, 'dbip-city-lite.mmdb') };

  try {
    if (existsSync(paths.lite)) liteReader = await maxmind.open<AnyRec>(paths.lite);
  } catch {
    liteReader = null;
  }
  try {
    if (existsSync(paths.country))
      countryReader = await maxmind.open<AnyRec>(paths.country);
  } catch {
    countryReader = null;
  }
  try {
    if (existsSync(paths.asn)) asnReader = await maxmind.open<AnyRec>(paths.asn);
  } catch {
    asnReader = null;
  }
  try {
    if (existsSync(paths.city)) cityReader = await maxmind.open<AnyRec>(paths.city);
  } catch {
    cityReader = null;
  }
}

export function resetGeoipReaders(): void {
  countryReader = null;
  asnReader = null;
  liteReader = null;
  cityReader = null;
  openedDir = null;
}

export async function lookupIp(dataDir: string, ip: string): Promise<GeoLookupResult> {
  const notes: string[] = [];
  const trimmed = normalizeIp(ip.trim()) ?? ip.trim();
  if (!trimmed) {
    return { ip: '', ok: false, notes: [tl('notes.auto.n1415')] };
  }
  if (!isValidIp(trimmed)) {
    return { ip: trimmed, ok: false, notes: [tl('notes.invalidIp46')] };
  }
  if (isPrivateOrLocalIp(trimmed)) {
    return {
      ip: trimmed,
      ok: true,
      country: 'ZZ',
      countryName: 'Private/Local',
      notes: [tl('notes.auto.n1294')] };
  }

  await openReaders(dataDir);
  const status = listGeoipSourceStatus(dataDir);
  if (!liteReader && !countryReader && !asnReader && !cityReader) {
    return {
      ip: trimmed,
      ok: false,
      notes: [
        tl('notes.auto.n0702'),
        `provider=${status.provider}`,
      ] };
  }

  let country: string | undefined;
  let countryName: string | undefined;
  let continent: string | undefined;
  let continentName: string | undefined;
  let regionCode: string | undefined;
  let regionName: string | undefined;
  let city: string | undefined;
  let latitude: number | undefined;
  let longitude: number | undefined;
  let accuracyRadiusKm: number | undefined;
  let asn: string | undefined;
  let asName: string | undefined;
  let asDomain: string | undefined;
  let source = status.provider;

  try {
    if (cityReader) {
      const rec = cityReader.get(trimmed);
      if (rec) {
        const c = parseCityStyleRecord(rec);
        country = c.country ?? country;
        countryName = c.countryName ?? countryName;
        continent = c.continent ?? continent;
        continentName = c.continentName ?? continentName;
        regionCode = c.regionCode ?? regionCode;
        regionName = c.regionName ?? regionName;
        city = c.city ?? city;
        latitude = c.latitude ?? latitude;
        longitude = c.longitude ?? longitude;
        accuracyRadiusKm = pickNum(rec, ['accuracy_radius', 'radius']);
        source = source.includes('dbip') ? source : `${source}+dbip`;
      }
    }

    if (liteReader) {
      const rec = liteReader.get(trimmed);
      if (rec) {
        country =
          pickStr(rec, ['country_code', 'country', 'country_iso_code']) ?? country;
        countryName = pickStr(rec, ['country_name', 'country']) ?? countryName;
        continent =
          pickStr(rec, ['continent_code', 'continent']) ?? continent;
        continentName =
          pickStr(rec, ['continent_name', 'continent']) ?? continentName;
        const rawAsn = pickStr(rec, ['asn', 'as_number', 'autonomous_system_number']);
        if (rawAsn) asn = normalizeAsn(rawAsn);
        asName =
          pickStr(rec, ['as_name', 'as_org', 'autonomous_system_organization', 'name']) ??
          asName;
        asDomain = pickStr(rec, ['as_domain', 'domain']) ?? asDomain;
        if (!source.includes('ipinfo')) source = `${source}+ipinfo`;
      }
    }

    if (countryReader && !country) {
      const rec = countryReader.get(trimmed);
      if (rec) {
        country =
          pickStr(rec, ['country_code', 'country', 'country_iso_code', 'iso_code']) ??
          (typeof rec === 'string' ? rec : undefined);
        if (!country) {
          const first = Object.values(rec).find(
            (v) => typeof v === 'string' && /^[A-Z]{2}$/i.test(v),
          );
          if (typeof first === 'string') country = first.toUpperCase();
        }
      }
    }

    if (asnReader && !asn) {
      const rec = asnReader.get(trimmed);
      if (rec) {
        const rawAsn = pickStr(rec, [
          'autonomous_system_number',
          'asn',
          'as_number',
          'as',
        ]);
        if (rawAsn) asn = normalizeAsn(rawAsn);
        asName =
          pickStr(rec, [
            'autonomous_system_organization',
            'as_name',
            'as_org',
            'organization',
            'name',
          ]) ?? asName;
      }
    }
  } catch (e) {
    notes.push(e instanceof Error ? e.message : String(e));
    return { ip: trimmed, ok: false, notes };
  }

  if (country) country = country.toUpperCase();
  if (continent) continent = continent.toUpperCase();
  if (regionCode) regionCode = regionCode.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const regionKey = makeRegionKey(country, regionCode, regionName);
  const cityKey = makeCityKey(country, city);

  if (!cityReader) {
    notes.push(tl('notes.auto.n0977'));
  }

  if (!country && !asn && !city && !regionName) {
    notes.push(tl('notes.auto.n0818'));
    return { ip: trimmed, ok: false, notes, source };
  }

  let confidenceHint: GeoLookupResult['confidenceHint'] = 'country';
  if (city) confidenceHint = 'city';
  else if (regionKey || regionName) confidenceHint = 'region';

  return {
    ip: trimmed,
    country,
    countryName,
    continent,
    continentName,
    regionCode,
    regionName,
    regionKey,
    city,
    cityKey,
    latitude,
    longitude,
    accuracyRadiusKm,
    asn,
    asName,
    asDomain,
    source,
    ok: true,
    notes,
    confidenceHint };
}
