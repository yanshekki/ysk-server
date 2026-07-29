/**
 * Persist IP access policy (country / continent / region / city / ASN).
 */

import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { JsonStore } from '../../../db/store.js';
import {
  DEFAULT_IP_ACCESS_POLICY,
  normalizeAsn,
  normalizeCityKey,
  normalizeContinent,
  normalizeCountry,
  normalizeRegionKey,
  type GeoLookupResult,
  type IpAccessPolicy,
} from './types.js';

const SETTINGS_KEY = 'defense_ip_access';

export function policyPath(dataDir: string): string {
  return join(dataDir, 'geoip', 'policy.json');
}

export function loadIpAccessPolicy(db: JsonStore, dataDir?: string): IpAccessPolicy {
  try {
    const raw = db.snapshot.settings?.[SETTINGS_KEY];
    if (raw) return sanitizePolicy(JSON.parse(raw) as Partial<IpAccessPolicy>);
  } catch {
    /* fall through */
  }
  if (dataDir) {
    try {
      const p = policyPath(dataDir);
      if (existsSync(p)) {
        return sanitizePolicy(JSON.parse(readFileSync(p, 'utf8')) as Partial<IpAccessPolicy>);
      }
    } catch {
      /* default */
    }
  }
  return {
    ...DEFAULT_IP_ACCESS_POLICY,
    countries: [],
    continents: [],
    regions: [],
    cities: [],
    asns: [],
  };
}

export function saveIpAccessPolicy(
  db: JsonStore,
  dataDir: string,
  patch: Partial<IpAccessPolicy>,
): IpAccessPolicy {
  const cur = loadIpAccessPolicy(db, dataDir);
  const next = sanitizePolicy({
    ...cur,
    ...patch,
    enforce: { ...cur.enforce, ...patch.enforce },
    countries: patch.countries ?? cur.countries,
    continents: patch.continents ?? cur.continents,
    regions: patch.regions ?? cur.regions,
    cities: patch.cities ?? cur.cities,
    asns: patch.asns ?? cur.asns,
    cityPolicyEnabled:
      patch.cityPolicyEnabled !== undefined
        ? patch.cityPolicyEnabled
        : cur.cityPolicyEnabled,
    updatedAt: new Date().toISOString(),
  });
  db.snapshot.settings[SETTINGS_KEY] = JSON.stringify(next);
  db.persist();
  const dir = join(dataDir, 'geoip');
  mkdirSync(dir, { recursive: true });
  writeFileSync(policyPath(dataDir), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function sanitizePolicy(p: Partial<IpAccessPolicy>): IpAccessPolicy {
  return {
    enabled: Boolean(p.enabled),
    mode: p.mode === 'allow_list' ? 'allow_list' : 'deny_list',
    countries: [...new Set((p.countries ?? []).map(normalizeCountry).filter(Boolean))].slice(
      0,
      80,
    ),
    continents: [
      ...new Set((p.continents ?? []).map(normalizeContinent).filter(Boolean)),
    ].slice(0, 16),
    regions: [
      ...new Set((p.regions ?? []).map(normalizeRegionKey).filter(Boolean)),
    ].slice(0, 200),
    cities: [...new Set((p.cities ?? []).map(normalizeCityKey).filter(Boolean))].slice(
      0,
      100,
    ),
    cityPolicyEnabled: Boolean(p.cityPolicyEnabled),
    asns: [...new Set((p.asns ?? []).map(normalizeAsn).filter(Boolean))].slice(0, 100),
    enforce: {
      autoBan: p.enforce?.autoBan !== false,
      nginx: p.enforce?.nginx !== false,
      ufw: Boolean(p.enforce?.ufw),
    },
    autoUpdate: p.autoUpdate !== false,
    updatedAt: p.updatedAt,
  };
}

/** Loose region match: US-CA ↔ California / US-CALIFORNIA */
function matchRegion(policyRegions: string[], lookup: GeoLookupResult): string | null {
  const key = lookup.regionKey?.toUpperCase();
  if (key && policyRegions.includes(key)) return key;
  const cc = lookup.country?.toUpperCase();
  const name = (lookup.regionName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const code = (lookup.regionCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const r of policyRegions) {
    const pr = r.toUpperCase();
    if (key && pr === key) return r;
    if (cc && pr.startsWith(`${cc}-`)) {
      const rest = pr.slice(3);
      if (code && rest === code) return r;
      if (name && (name === rest || name.startsWith(rest) || rest.startsWith(name.slice(0, 4))))
        return r;
    }
  }
  return null;
}

/**
 * Evaluate whether IP is blocked by policy given a lookup result.
 * Match order (deny: any hit blocks): city → region → country → continent → asn
 */
export function evaluateIpAccess(
  lookup: GeoLookupResult,
  policy: IpAccessPolicy,
  opts?: { whitelisted?: boolean },
): {
  blocked: boolean;
  reason?: string;
  matched: string[];
} {
  if (opts?.whitelisted) {
    return { blocked: false, reason: 'whitelist', matched: ['whitelist'] };
  }
  if (!policy.enabled) {
    return { blocked: false, reason: 'policy_disabled', matched: [] };
  }

  const matched: string[] = [];
  const cc = lookup.country?.toUpperCase();
  const cont = lookup.continent?.toUpperCase();
  const asn = lookup.asn ? normalizeAsn(lookup.asn) : '';
  const cityKey = lookup.cityKey;
  const regionHit = matchRegion(policy.regions, lookup);

  if (policy.cityPolicyEnabled && cityKey && policy.cities.includes(cityKey)) {
    matched.push(`city:${cityKey}`);
  }
  if (regionHit) {
    matched.push(`region:${regionHit}`);
  }
  if (cc && policy.countries.includes(cc)) matched.push(`country:${cc}`);
  if (cont && policy.continents.includes(cont)) matched.push(`continent:${cont}`);
  if (asn && policy.asns.includes(asn)) matched.push(`asn:${asn}`);

  if (policy.mode === 'deny_list') {
    if (matched.length === 0) return { blocked: false, matched: [] };
    return { blocked: true, reason: 'deny_list', matched };
  }

  const hasRules =
    policy.countries.length +
      policy.continents.length +
      policy.regions.length +
      (policy.cityPolicyEnabled ? policy.cities.length : 0) +
      policy.asns.length >
    0;
  if (!hasRules) {
    return { blocked: false, reason: 'allow_list_empty', matched: [] };
  }
  if (matched.length > 0) {
    return { blocked: false, reason: 'allow_list_match', matched };
  }
  if (!cc && !cont && !asn && !lookup.regionKey && !cityKey) {
    return { blocked: true, reason: 'allow_list_unknown', matched: ['unknown'] };
  }
  return { blocked: true, reason: 'allow_list_miss', matched: [] };
}
