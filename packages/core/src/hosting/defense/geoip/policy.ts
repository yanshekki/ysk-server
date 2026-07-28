/**
 * Persist IP access policy (country / continent / ASN).
 */

import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { JsonStore } from '../../../db/store.js';
import {
  DEFAULT_IP_ACCESS_POLICY,
  normalizeAsn,
  normalizeContinent,
  normalizeCountry,
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
  return { ...DEFAULT_IP_ACCESS_POLICY, countries: [], continents: [], asns: [] };
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
    asns: patch.asns ?? cur.asns,
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

/**
 * Evaluate whether IP is blocked by policy given a lookup result.
 * Private / unknown geo: deny_list → allow; allow_list → block (strict).
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

  if (cc && policy.countries.includes(cc)) matched.push(`country:${cc}`);
  if (cont && policy.continents.includes(cont)) matched.push(`continent:${cont}`);
  if (asn && policy.asns.includes(asn)) matched.push(`asn:${asn}`);

  if (policy.mode === 'deny_list') {
    if (matched.length === 0) return { blocked: false, matched: [] };
    return { blocked: true, reason: 'deny_list', matched };
  }

  // allow_list: must match at least one dimension if lists non-empty
  const hasRules =
    policy.countries.length + policy.continents.length + policy.asns.length > 0;
  if (!hasRules) {
    return { blocked: false, reason: 'allow_list_empty', matched: [] };
  }
  if (matched.length > 0) {
    return { blocked: false, reason: 'allow_list_match', matched };
  }
  // Unknown geo under allow_list → block (fail-closed for public)
  if (!cc && !cont && !asn) {
    return { blocked: true, reason: 'allow_list_unknown', matched: ['unknown'] };
  }
  return { blocked: true, reason: 'allow_list_miss', matched: [] };
}
