/**
 * GeoIP access policy + lookup types.
 */

export type IpAccessMode = 'deny_list' | 'allow_list';

export type IpAccessPolicy = {
  enabled: boolean;
  mode: IpAccessMode;
  /** ISO 3166-1 alpha-2 */
  countries: string[];
  /** Continent codes: AS EU NA AF SA OC AN */
  continents: string[];
  /** ASN as "AS13335" or "13335" */
  asns: string[];
  enforce: {
    /** Enrich suspects + block via ban path when matched */
    autoBan: boolean;
    /** Write nginx geoip2 snippet when module available (best-effort) */
    nginx: boolean;
    /** Never bulk-expand whole countries into UFW */
    ufw: boolean;
  };
  /** Auto-refresh geo DBs on schedule */
  autoUpdate: boolean;
  updatedAt?: string;
};

export type GeoLookupResult = {
  ip: string;
  country?: string;
  countryName?: string;
  continent?: string;
  continentName?: string;
  asn?: string;
  asName?: string;
  asDomain?: string;
  source?: string;
  ok: boolean;
  notes: string[];
};

export type GeoipMetaFile = {
  provider: string;
  files: Array<{
    filename: string;
    url: string;
    downloadedAt: string;
    bytes: number;
    etag?: string;
    ok: boolean;
    error?: string;
  }>;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  attribution?: string;
};

export type GeoipStatus = {
  provider: string;
  dir: string;
  ready: boolean;
  stale: boolean;
  meta: GeoipMetaFile | null;
  sources: Array<{
    filename: string;
    url: string;
    license: string;
    updateHint: string;
    present: boolean;
    mtime?: string;
    bytes?: number;
  }>;
  attribution: string[];
  policy: IpAccessPolicy;
  notes: string[];
};

export const DEFAULT_IP_ACCESS_POLICY: IpAccessPolicy = {
  enabled: false,
  mode: 'deny_list',
  countries: [],
  continents: [],
  asns: [],
  enforce: {
    autoBan: true,
    nginx: true,
    ufw: false,
  },
  autoUpdate: true,
};

export function normalizeAsn(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/^AS/, '');
  if (!/^\d+$/.test(s)) return '';
  return `AS${s}`;
}

export function normalizeCountry(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return '';
  return s;
}

export function normalizeContinent(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return '';
  return s;
}
