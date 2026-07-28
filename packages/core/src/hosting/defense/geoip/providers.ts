/**
 * GeoIP / ASN database providers — offline MMDB sources with regular updates.
 */

export type GeoipProviderId = 'sapics' | 'ipinfo';

export type GeoipDbKind = 'country' | 'asn' | 'lite';

export type GeoipSource = {
  provider: GeoipProviderId;
  kind: GeoipDbKind;
  /** Local basename under dataDir/geoip/ */
  filename: string;
  url: string;
  license: string;
  updateHint: string;
  /** Attribution text for UI (empty if PDDL / none required) */
  attribution: string;
};

const SAPICS_BASE =
  'https://github.com/sapics/ip-location-db/releases/download/latest';

/** Default no-token sources (PDDL — free commercial use). */
export function sapicsSources(): GeoipSource[] {
  return [
    {
      provider: 'sapics',
      kind: 'country',
      filename: 'user-country.mmdb',
      url: `${SAPICS_BASE}/user-country.mmdb`,
      license: 'PDDL-1.0',
      updateHint: '每日（GitHub Releases latest）',
      attribution: '',
    },
    {
      provider: 'sapics',
      kind: 'asn',
      filename: 'origin-asn.mmdb',
      url: `${SAPICS_BASE}/origin-asn.mmdb`,
      license: 'PDDL-1.0',
      updateHint: '每日（GitHub Releases latest）',
      attribution: '',
    },
  ];
}

/** IPinfo Lite — country + continent + ASN in one file (needs free token). */
export function ipinfoLiteSource(token: string): GeoipSource {
  const t = encodeURIComponent(token.trim());
  return {
    provider: 'ipinfo',
    kind: 'lite',
    filename: 'ipinfo_lite.mmdb',
    url: `https://ipinfo.io/data/ipinfo_lite.mmdb?token=${t}`,
    license: 'CC-BY-SA-4.0',
    updateHint: '每日（IPinfo Lite）',
    attribution: 'IP address data powered by IPinfo (https://ipinfo.io)',
  };
}

export function resolveGeoipSources(env: NodeJS.ProcessEnv = process.env): {
  provider: GeoipProviderId;
  sources: GeoipSource[];
} {
  const forced = (env.YSK_GEOIP_PROVIDER || '').toLowerCase();
  const token = env.IPINFO_TOKEN?.trim() || env.YSK_IPINFO_TOKEN?.trim() || '';

  if (forced === 'ipinfo' || (forced !== 'sapics' && token)) {
    if (!token) {
      return { provider: 'sapics', sources: sapicsSources() };
    }
    return { provider: 'ipinfo', sources: [ipinfoLiteSource(token)] };
  }
  return { provider: 'sapics', sources: sapicsSources() };
}
