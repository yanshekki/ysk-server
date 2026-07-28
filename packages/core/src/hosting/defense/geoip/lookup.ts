/**
 * Offline MMDB lookup — flexible field mapping for sapics / IPinfo Lite.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import maxmind, { type Reader } from 'maxmind';
import { geoipDir, listGeoipSourceStatus } from './downloader.js';
import { normalizeAsn } from './types.js';
import type { GeoLookupResult } from './types.js';

type AnyRec = Record<string, unknown>;

let countryReader: Reader<AnyRec> | null = null;
let asnReader: Reader<AnyRec> | null = null;
let liteReader: Reader<AnyRec> | null = null;
let openedDir: string | null = null;

function pickStr(obj: AnyRec | null | undefined, keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    // nested { names: { en: ... } } maxmind style
    if (v && typeof v === 'object') {
      const o = v as AnyRec;
      if (typeof o.iso_code === 'string') return o.iso_code;
      if (typeof o.code === 'string') return o.code;
      const names = o.names as AnyRec | undefined;
      if (names && typeof names.en === 'string') return names.en;
    }
  }
  return undefined;
}

async function openReaders(dataDir: string): Promise<void> {
  const dir = geoipDir(dataDir);
  if (openedDir === dir && (liteReader || countryReader || asnReader)) return;

  countryReader = null;
  asnReader = null;
  liteReader = null;
  openedDir = dir;

  const litePath = join(dir, 'ipinfo_lite.mmdb');
  const countryPath = join(dir, 'user-country.mmdb');
  const asnPath = join(dir, 'origin-asn.mmdb');

  try {
    if (existsSync(litePath)) {
      liteReader = await maxmind.open<AnyRec>(litePath);
    }
  } catch {
    liteReader = null;
  }
  try {
    if (existsSync(countryPath)) {
      countryReader = await maxmind.open<AnyRec>(countryPath);
    }
  } catch {
    countryReader = null;
  }
  try {
    if (existsSync(asnPath)) {
      asnReader = await maxmind.open<AnyRec>(asnPath);
    }
  } catch {
    asnReader = null;
  }
}

/** Force re-open after download. */
export function resetGeoipReaders(): void {
  countryReader = null;
  asnReader = null;
  liteReader = null;
  openedDir = null;
}

function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

export async function lookupIp(dataDir: string, ip: string): Promise<GeoLookupResult> {
  const trimmed = ip.trim();
  const notes: string[] = [];
  if (!trimmed) {
    return { ip: '', ok: false, notes: ['請提供 IP'] };
  }
  if (isPrivateIp(trimmed)) {
    return {
      ip: trimmed,
      ok: true,
      country: 'ZZ',
      countryName: 'Private/Local',
      notes: ['私網／本機，不套用公網 geo'],
    };
  }

  await openReaders(dataDir);
  const status = listGeoipSourceStatus(dataDir);
  if (!liteReader && !countryReader && !asnReader) {
    return {
      ip: trimmed,
      ok: false,
      notes: [
        '尚未下載 GeoIP 庫 — 請在防護中心「IP 准入」按更新，或等每日排程',
        `provider=${status.provider}`,
      ],
    };
  }

  let country: string | undefined;
  let countryName: string | undefined;
  let continent: string | undefined;
  let continentName: string | undefined;
  let asn: string | undefined;
  let asName: string | undefined;
  let asDomain: string | undefined;
  let source: string = status.provider;

  try {
    if (liteReader) {
      const rec = liteReader.get(trimmed);
      if (rec) {
        country =
          pickStr(rec, ['country_code', 'country', 'country_iso_code']) ?? country;
        countryName = pickStr(rec, ['country_name', 'country']) ?? countryName;
        continent =
          pickStr(rec, ['continent_code', 'continent']) ?? continent;
        continentName = pickStr(rec, ['continent_name', 'continent']) ?? continentName;
        const rawAsn = pickStr(rec, ['asn', 'as_number', 'autonomous_system_number']);
        if (rawAsn) asn = normalizeAsn(rawAsn);
        asName = pickStr(rec, ['as_name', 'as_org', 'autonomous_system_organization', 'name']);
        asDomain = pickStr(rec, ['as_domain', 'domain']);
        source = 'ipinfo_lite';
      }
    }

    if (countryReader && !country) {
      const rec = countryReader.get(trimmed);
      if (rec) {
        country =
          pickStr(rec, ['country_code', 'country', 'country_iso_code', 'iso_code']) ??
          // sapics sometimes stores plain string values
          (typeof rec === 'string' ? rec : undefined);
        // some DBs: { country_code: 'US' }
        if (!country && Array.isArray(Object.values(rec))) {
          const first = Object.values(rec).find((v) => typeof v === 'string' && /^[A-Z]{2}$/i.test(v));
          if (typeof first === 'string') country = first.toUpperCase();
        }
        source = source === 'ipinfo_lite' ? source : 'sapics_country';
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
        source = source.includes('ipinfo') ? source : 'sapics_asn';
      }
    }
  } catch (e) {
    notes.push(e instanceof Error ? e.message : String(e));
    return { ip: trimmed, ok: false, notes };
  }

  if (country) country = country.toUpperCase();
  if (continent) continent = continent.toUpperCase();
  // continent from country if only 2-letter country known and looks like continent code wrongly — skip

  if (!country && !asn) {
    notes.push('庫中無此 IP 記錄');
    return { ip: trimmed, ok: false, notes, source };
  }

  return {
    ip: trimmed,
    country,
    countryName,
    continent,
    continentName,
    asn,
    asName,
    asDomain,
    source,
    ok: true,
    notes,
  };
}
