import { tl } from '@ysk-server/shared';
/**
 * GeoIP / ASN database providers — free-tier max = city lite (region + city).
 */

export type GeoipProviderId = 'sapics' | 'ipinfo' | 'dbip';

export type GeoipDbKind = 'country' | 'asn' | 'lite' | 'city';

export type GeoipSource = {
  provider: GeoipProviderId;
  kind: GeoipDbKind;
  filename: string;
  url: string;
  license: string;
  updateHint: string;
  attribution: string;
  /** Response may be gzip */
  gzip?: boolean;
};

const SAPICS_BASE =
  'https://github.com/sapics/ip-location-db/releases/download/latest';

const DBIP_ATTR =
  'IP Geolocation by DB-IP (https://db-ip.com) · CC BY 4.0';

export function sapicsSources(): GeoipSource[] {
  return [
    {
      provider: 'sapics',
      kind: 'country',
      filename: 'user-country.mmdb',
      url: `${SAPICS_BASE}/user-country.mmdb`,
      license: 'PDDL-1.0',
      updateHint: tl('notes.auto.n0045'),
      attribution: '' },
    {
      provider: 'sapics',
      kind: 'asn',
      filename: 'origin-asn.mmdb',
      url: `${SAPICS_BASE}/origin-asn.mmdb`,
      license: 'PDDL-1.0',
      updateHint: tl('notes.auto.n0045'),
      attribution: '' },
  ];
}

/** DB-IP City Lite — free, no key; country + state/prov + city + coords */
export function dbipCityLiteSources(env: NodeJS.ProcessEnv = process.env): GeoipSource[] {
  const override = env.YSK_GEOIP_CITY_URL?.trim();
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-12
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;

  const url =
    override ||
    `https://download.db-ip.com/free/dbip-city-lite-${ym}.mmdb.gz`;

  return [
    {
      provider: 'dbip',
      kind: 'city',
      filename: 'dbip-city-lite.mmdb',
      url,
      license: 'CC-BY-4.0',
      updateHint: tl('notes.auto.t0772', { v0: (ym) }),
      attribution: DBIP_ATTR,
      gzip: !override || /\.gz(\?|$)/i.test(override),
      // stash fallback month in url via custom field — handled in downloader
    },
    // Soft fallback source attempted only if primary fails (same dest file)
    {
      provider: 'dbip',
      kind: 'city',
      filename: 'dbip-city-lite.mmdb',
      url:
        env.YSK_GEOIP_CITY_URL_FALLBACK?.trim() ||
        `https://download.db-ip.com/free/dbip-city-lite-${prev}.mmdb.gz`,
      license: 'CC-BY-4.0',
      updateHint: tl('notes.auto.t0773', { v0: (prev) }),
      attribution: DBIP_ATTR,
      gzip: true },
  ];
}

export function ipinfoLiteSource(token: string): GeoipSource {
  const t = encodeURIComponent(token.trim());
  return {
    provider: 'ipinfo',
    kind: 'lite',
    filename: 'ipinfo_lite.mmdb',
    url: `https://ipinfo.io/data/ipinfo_lite.mmdb?token=${t}`,
    license: 'CC-BY-SA-4.0',
    updateHint: tl('notes.auto.n1045'),
    attribution: 'IP address data powered by IPinfo (https://ipinfo.io)' };
}

/**
 * Free max stack: sapics country+asn + DB-IP city lite (+ optional IPinfo lite).
 */
export function resolveGeoipSources(env: NodeJS.ProcessEnv = process.env): {
  provider: string;
  sources: GeoipSource[];
} {
  const profile = (env.YSK_GEOIP_PROFILE || 'city_lite').toLowerCase();
  const token = env.IPINFO_TOKEN?.trim() || env.YSK_IPINFO_TOKEN?.trim() || '';
  const sources: GeoipSource[] = [...sapicsSources()];

  if (profile !== 'country_asn') {
    // Only one city file: downloader will try primary then skip duplicate filename if ok
    sources.push(...dbipCityLiteSources(env));
  }

  if (token) {
    sources.push(ipinfoLiteSource(token));
  }

  const provider =
    profile === 'country_asn'
      ? token
        ? 'sapics+ipinfo'
        : 'sapics'
      : token
        ? 'sapics+dbip+ipinfo'
        : 'sapics+dbip';

  return { provider, sources };
}

export { DBIP_ATTR };
