/**
 * GeoIP access policy + lookup types.
 * Free tier max: country + region (province/state) + optional city + ASN.
 */

export type IpAccessMode = 'deny_list' | 'allow_list';

export type IpAccessPolicy = {
  enabled: boolean;
  mode: IpAccessMode;
  /** ISO 3166-1 alpha-2 */
  countries: string[];
  /** Continent codes: AS EU NA AF SA OC AN */
  continents: string[];
  /** Region keys: "CN-GD", "US-CA" */
  regions: string[];
  /**
   * City keys: "CN|Guangzhou" (country|city). Only evaluated when cityPolicyEnabled.
   */
  cities: string[];
  /** Default false — city is enrich-only unless user opts in */
  cityPolicyEnabled: boolean;
  /** ASN as "AS13335" or "13335" */
  asns: string[];
  enforce: {
    autoBan: boolean;
    nginx: boolean;
    ufw: boolean;
  };
  autoUpdate: boolean;
  updatedAt?: string;
};

export type GeoLookupResult = {
  ip: string;
  country?: string;
  countryName?: string;
  continent?: string;
  continentName?: string;
  regionCode?: string;
  regionName?: string;
  /** Policy key e.g. CN-GD */
  regionKey?: string;
  city?: string;
  /** Policy key e.g. CN|Guangzhou */
  cityKey?: string;
  latitude?: number;
  longitude?: number;
  accuracyRadiusKm?: number;
  asn?: string;
  asName?: string;
  asDomain?: string;
  source?: string;
  ok: boolean;
  notes: string[];
  confidenceHint?: 'country' | 'region' | 'city';
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
  cityReady: boolean;
  maxGranularity: 'country' | 'region' | 'city';
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
  regions: [],
  cities: [],
  cityPolicyEnabled: false,
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

/** CN-GD / US-CA */
export function normalizeRegionKey(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/_/g, '-');
  const m = /^([A-Z]{2})-([A-Z0-9]{1,8})$/.exec(s);
  if (!m) return '';
  return `${m[1]}-${m[2]}`;
}

/** CN|Guangzhou */
export function normalizeCityKey(raw: string): string {
  const s = raw.trim();
  const m = /^([A-Za-z]{2})\|(.+)$/.exec(s);
  if (!m) return '';
  const city = m[2].trim().replace(/\s+/g, ' ');
  if (!city || city.length > 80) return '';
  return `${m[1].toUpperCase()}|${city}`;
}

export function makeRegionKey(country?: string, regionCode?: string, regionName?: string): string | undefined {
  const cc = country ? normalizeCountry(country) : '';
  if (!cc) return undefined;
  if (regionCode) {
    const code = regionCode
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
    if (code) return `${cc}-${code}`;
  }
  if (regionName) {
    const slug = regionName
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 12);
    if (slug) return `${cc}-${slug}`;
  }
  return undefined;
}

export function makeCityKey(country?: string, city?: string): string | undefined {
  const cc = country ? normalizeCountry(country) : '';
  const c = city?.trim().replace(/\s+/g, ' ');
  if (!cc || !c) return undefined;
  return `${cc}|${c}`;
}
