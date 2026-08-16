/**
 * Selectable options for IP access policy (country / continent / ASN).
 * Labels via i18n: geo.continents.*, geo.countries.*, geo.regions.*, geo.asn.*
 * English `hint` is the neutral fallback for search.
 */

import type { TFunction } from 'i18next';

export type GeoOption = { value: string; label: string; hint?: string };

type GeoValue = { value: string; hint: string };

/** Continent codes + English hint (Phase1 region) */
const CONTINENT_VALUES: GeoValue[] = [
  { value: 'AS', hint: 'Asia' },
  { value: 'EU', hint: 'Europe' },
  { value: 'NA', hint: 'North America' },
  { value: 'SA', hint: 'South America' },
  { value: 'AF', hint: 'Africa' },
  { value: 'OC', hint: 'Oceania' },
  { value: 'AN', hint: 'Antarctica' },
];

/** Common country ISO codes + English hint */
const COUNTRY_VALUES: GeoValue[] = [
  { value: 'CN', hint: 'China' },
  { value: 'HK', hint: 'Hong Kong' },
  { value: 'MO', hint: 'Macao' },
  { value: 'TW', hint: 'Taiwan' },
  { value: 'JP', hint: 'Japan' },
  { value: 'KR', hint: 'South Korea' },
  { value: 'KP', hint: 'North Korea' },
  { value: 'SG', hint: 'Singapore' },
  { value: 'MY', hint: 'Malaysia' },
  { value: 'TH', hint: 'Thailand' },
  { value: 'VN', hint: 'Vietnam' },
  { value: 'PH', hint: 'Philippines' },
  { value: 'ID', hint: 'Indonesia' },
  { value: 'IN', hint: 'India' },
  { value: 'AU', hint: 'Australia' },
  { value: 'NZ', hint: 'New Zealand' },
  { value: 'US', hint: 'United States' },
  { value: 'CA', hint: 'Canada' },
  { value: 'MX', hint: 'Mexico' },
  { value: 'BR', hint: 'Brazil' },
  { value: 'AR', hint: 'Argentina' },
  { value: 'GB', hint: 'United Kingdom' },
  { value: 'IE', hint: 'Ireland' },
  { value: 'DE', hint: 'Germany' },
  { value: 'FR', hint: 'France' },
  { value: 'NL', hint: 'Netherlands' },
  { value: 'BE', hint: 'Belgium' },
  { value: 'CH', hint: 'Switzerland' },
  { value: 'AT', hint: 'Austria' },
  { value: 'SE', hint: 'Sweden' },
  { value: 'NO', hint: 'Norway' },
  { value: 'DK', hint: 'Denmark' },
  { value: 'FI', hint: 'Finland' },
  { value: 'PL', hint: 'Poland' },
  { value: 'CZ', hint: 'Czechia' },
  { value: 'ES', hint: 'Spain' },
  { value: 'PT', hint: 'Portugal' },
  { value: 'IT', hint: 'Italy' },
  { value: 'RU', hint: 'Russia' },
  { value: 'UA', hint: 'Ukraine' },
  { value: 'TR', hint: 'Turkey' },
  { value: 'IL', hint: 'Israel' },
  { value: 'AE', hint: 'UAE' },
  { value: 'SA', hint: 'Saudi Arabia' },
  { value: 'EG', hint: 'Egypt' },
  { value: 'ZA', hint: 'South Africa' },
  { value: 'NG', hint: 'Nigeria' },
  { value: 'PK', hint: 'Pakistan' },
  { value: 'BD', hint: 'Bangladesh' },
  { value: 'IR', hint: 'Iran' },
  { value: 'IQ', hint: 'Iraq' },
  { value: 'RO', hint: 'Romania' },
  { value: 'BG', hint: 'Bulgaria' },
  { value: 'HU', hint: 'Hungary' },
  { value: 'GR', hint: 'Greece' },
  { value: 'LT', hint: 'Lithuania' },
  { value: 'LV', hint: 'Latvia' },
  { value: 'EE', hint: 'Estonia' },
  { value: 'BY', hint: 'Belarus' },
  { value: 'KZ', hint: 'Kazakhstan' },
  { value: 'UZ', hint: 'Uzbekistan' },
  { value: 'CL', hint: 'Chile' },
  { value: 'CO', hint: 'Colombia' },
  { value: 'PE', hint: 'Peru' },
  { value: 'VE', hint: 'Venezuela' },
  { value: 'CU', hint: 'Cuba' },
  { value: 'SC', hint: 'Seychelles' },
  { value: 'PA', hint: 'Panama' },
];

/** Common network providers (ASN) — brand labels (no locale CJK) */
export const GEO_ASN_PROVIDERS: GeoOption[] = [
  { value: 'AS13335', label: 'Cloudflare', hint: 'AS13335' },
  { value: 'AS16509', label: 'Amazon AWS', hint: 'AS16509' },
  { value: 'AS14618', label: 'Amazon AWS (legacy)', hint: 'AS14618' },
  { value: 'AS15169', label: 'Google', hint: 'AS15169' },
  { value: 'AS396982', label: 'Google Cloud', hint: 'AS396982' },
  { value: 'AS8075', label: 'Microsoft', hint: 'AS8075' },
  { value: 'AS32934', label: 'Meta / Facebook', hint: 'AS32934' },
  { value: 'AS54113', label: 'Fastly', hint: 'AS54113' },
  { value: 'AS20940', label: 'Akamai', hint: 'AS20940' },
  { value: 'AS9009', label: 'M247', hint: 'AS9009' },
  { value: 'AS16276', label: 'OVH', hint: 'AS16276' },
  { value: 'AS24940', label: 'Hetzner', hint: 'AS24940' },
  { value: 'AS14061', label: 'DigitalOcean', hint: 'AS14061' },
  { value: 'AS63949', label: 'Linode / Akamai', hint: 'AS63949' },
  { value: 'AS20473', label: 'Vultr', hint: 'AS20473' },
  { value: 'AS31898', label: 'Oracle Cloud', hint: 'AS31898' },
  { value: 'AS45102', label: 'Alibaba Cloud', hint: 'AS45102' },
  { value: 'AS45090', label: 'Tencent Cloud', hint: 'AS45090' },
  { value: 'AS55967', label: 'Baidu', hint: 'AS55967' },
  { value: 'AS4134', label: 'Chinanet', hint: 'AS4134' },
  { value: 'AS4837', label: 'China Unicom', hint: 'AS4837' },
  { value: 'AS9808', label: 'China Mobile', hint: 'AS9808' },
  { value: 'AS56040', label: 'China Mobile CMNET', hint: 'AS56040' },
  { value: 'AS4766', label: 'Korea Telecom', hint: 'AS4766' },
  { value: 'AS9318', label: 'SK Broadband', hint: 'AS9318' },
  { value: 'AS2516', label: 'KDDI', hint: 'AS2516' },
  { value: 'AS4713', label: 'NTT Communications', hint: 'AS4713' },
  { value: 'AS2914', label: 'NTT America', hint: 'AS2914' },
  { value: 'AS174', label: 'Cogent', hint: 'AS174' },
  { value: 'AS3356', label: 'Lumen / Level3', hint: 'AS3356' },
  { value: 'AS1299', label: 'Arelion / Telia', hint: 'AS1299' },
  { value: 'AS6939', label: 'Hurricane Electric', hint: 'AS6939' },
  { value: 'AS7018', label: 'AT&T', hint: 'AS7018' },
  { value: 'AS7922', label: 'Comcast', hint: 'AS7922' },
  { value: 'AS701', label: 'Verizon', hint: 'AS701' },
  { value: 'AS9269', label: 'HKBN', hint: 'AS9269' },
  { value: 'AS4760', label: 'HKT / PCCW', hint: 'AS4760' },
  { value: 'AS9304', label: 'HGC', hint: 'AS9304' },
  { value: 'AS10103', label: 'HK Broadband', hint: 'AS10103' },
  { value: 'AS3491', label: 'PCCW Global', hint: 'AS3491' },
  { value: 'AS7473', label: 'Singtel', hint: 'AS7473' },
  { value: 'AS46562', label: 'Performive', hint: 'AS46562' },
  { value: 'AS60068', label: 'Datacamp / CDN77', hint: 'AS60068' },
  { value: 'AS212238', label: 'Datacamp Limited', hint: 'AS212238' },
  { value: 'AS51167', label: 'Contabo', hint: 'AS51167' },
  { value: 'AS12876', label: 'Scaleway', hint: 'AS12876' },
];

type RegionValue = GeoValue & { country: string };

/** Region codes (country-regionKey) for free-tier province/state policy */
const REGION_VALUES: RegionValue[] = [
  { value: 'CN-BJ', country: 'CN', hint: 'Beijing' },
  { value: 'CN-SH', country: 'CN', hint: 'Shanghai' },
  { value: 'CN-TJ', country: 'CN', hint: 'Tianjin' },
  { value: 'CN-CQ', country: 'CN', hint: 'Chongqing' },
  { value: 'CN-GD', country: 'CN', hint: 'Guangdong' },
  { value: 'CN-ZJ', country: 'CN', hint: 'Zhejiang' },
  { value: 'CN-JS', country: 'CN', hint: 'Jiangsu' },
  { value: 'CN-SD', country: 'CN', hint: 'Shandong' },
  { value: 'CN-HN', country: 'CN', hint: 'Henan' },
  { value: 'CN-HB', country: 'CN', hint: 'Hubei' },
  { value: 'CN-HU', country: 'CN', hint: 'Hunan' },
  { value: 'CN-SC', country: 'CN', hint: 'Sichuan' },
  { value: 'CN-HE', country: 'CN', hint: 'Hebei' },
  { value: 'CN-FJ', country: 'CN', hint: 'Fujian' },
  { value: 'CN-AH', country: 'CN', hint: 'Anhui' },
  { value: 'CN-JX', country: 'CN', hint: 'Jiangxi' },
  { value: 'CN-LN', country: 'CN', hint: 'Liaoning' },
  { value: 'CN-JL', country: 'CN', hint: 'Jilin' },
  { value: 'CN-HL', country: 'CN', hint: 'Heilongjiang' },
  { value: 'CN-SX', country: 'CN', hint: 'Shanxi' },
  { value: 'CN-SN', country: 'CN', hint: 'Shaanxi' },
  { value: 'CN-GS', country: 'CN', hint: 'Gansu' },
  { value: 'CN-QH', country: 'CN', hint: 'Qinghai' },
  { value: 'CN-HA', country: 'CN', hint: 'Hainan' },
  { value: 'CN-YN', country: 'CN', hint: 'Yunnan' },
  { value: 'CN-GZ', country: 'CN', hint: 'Guizhou' },
  { value: 'CN-GX', country: 'CN', hint: 'Guangxi' },
  { value: 'CN-NX', country: 'CN', hint: 'Ningxia' },
  { value: 'CN-XJ', country: 'CN', hint: 'Xinjiang' },
  { value: 'CN-XZ', country: 'CN', hint: 'Tibet' },
  { value: 'CN-NM', country: 'CN', hint: 'Inner Mongolia' },
  { value: 'TW-TPE', country: 'TW', hint: 'Taipei' },
  { value: 'TW-TXG', country: 'TW', hint: 'Taichung' },
  { value: 'TW-KHH', country: 'TW', hint: 'Kaohsiung' },
  { value: 'HK-HK', country: 'HK', hint: 'Hong Kong' },
  { value: 'MO-MO', country: 'MO', hint: 'Macao' },
  { value: 'US-CA', country: 'US', hint: 'California' },
  { value: 'US-NY', country: 'US', hint: 'New York' },
  { value: 'US-TX', country: 'US', hint: 'Texas' },
  { value: 'US-FL', country: 'US', hint: 'Florida' },
  { value: 'US-WA', country: 'US', hint: 'Washington' },
  { value: 'US-IL', country: 'US', hint: 'Illinois' },
  { value: 'US-VA', country: 'US', hint: 'Virginia' },
  { value: 'US-OR', country: 'US', hint: 'Oregon' },
  { value: 'US-GA', country: 'US', hint: 'Georgia' },
  { value: 'US-NJ', country: 'US', hint: 'New Jersey' },
  { value: 'US-MA', country: 'US', hint: 'Massachusetts' },
  { value: 'US-OH', country: 'US', hint: 'Ohio' },
  { value: 'US-PA', country: 'US', hint: 'Pennsylvania' },
  { value: 'US-AZ', country: 'US', hint: 'Arizona' },
  { value: 'US-CO', country: 'US', hint: 'Colorado' },
  { value: 'US-NC', country: 'US', hint: 'North Carolina' },
  { value: 'US-MI', country: 'US', hint: 'Michigan' },
  { value: 'US-NV', country: 'US', hint: 'Nevada' },
  { value: 'JP-13', country: 'JP', hint: 'Tokyo' },
  { value: 'JP-27', country: 'JP', hint: 'Osaka' },
  { value: 'JP-14', country: 'JP', hint: 'Kanagawa' },
  { value: 'JP-23', country: 'JP', hint: 'Aichi' },
  { value: 'KR-11', country: 'KR', hint: 'Seoul' },
  { value: 'KR-26', country: 'KR', hint: 'Busan' },
  { value: 'SG-01', country: 'SG', hint: 'Singapore' },
  { value: 'AU-NSW', country: 'AU', hint: 'New South Wales' },
  { value: 'AU-VIC', country: 'AU', hint: 'Victoria' },
  { value: 'GB-ENG', country: 'GB', hint: 'England' },
  { value: 'DE-BE', country: 'DE', hint: 'Berlin' },
  { value: 'DE-BY', country: 'DE', hint: 'Bavaria' },
  { value: 'RU-MOW', country: 'RU', hint: 'Moscow' },
  { value: 'RU-SPE', country: 'RU', hint: 'Saint Petersburg' },
];

function labelOf(t: TFunction | undefined, key: string, fallback: string): string {
  if (!t) return fallback;
  const translated = t(key);
  return translated === key ? fallback : translated;
}

/** Localized name plus English when they differ — e.g. 新南威爾士（New South Wales）. */
export function bilingualGeoLabel(
  t: TFunction | undefined,
  key: string,
  english: string,
): string {
  const loc = labelOf(t, key, english);
  if (!loc || loc === english) return english;
  return `${loc}（${english}）`;
}

/** @deprecated Prefer getGeoContinents(t) for localized labels */
export const GEO_CONTINENTS: GeoOption[] = CONTINENT_VALUES.map((c) => ({
  value: c.value,
  label: c.hint,
  hint: c.hint,
}));

/** @deprecated Prefer getGeoCountries(t) for localized labels */
export const GEO_COUNTRIES: GeoOption[] = COUNTRY_VALUES.map((c) => ({
  value: c.value,
  label: c.hint,
  hint: c.hint,
}));

/** @deprecated Prefer getGeoRegions(t) for localized labels */
export const GEO_REGIONS: (GeoOption & { country: string })[] = REGION_VALUES.map((r) => ({
  value: r.value,
  label: r.hint,
  hint: r.hint,
  country: r.country,
}));

export function getGeoContinents(t?: TFunction): GeoOption[] {
  return CONTINENT_VALUES.map((c) => ({
    value: c.value,
    label: bilingualGeoLabel(t, `geo.continents.${c.value}`, c.hint),
    hint: c.hint,
  }));
}

export function getGeoCountries(t?: TFunction): GeoOption[] {
  return COUNTRY_VALUES.map((c) => ({
    value: c.value,
    label: bilingualGeoLabel(t, `geo.countries.${c.value}`, c.hint),
    hint: c.hint,
  }));
}

export type GeoRegionOption = GeoOption & { country: string };

export function getGeoRegions(t?: TFunction, countries?: string[]): GeoRegionOption[] {
  let list = REGION_VALUES;
  if (countries && countries.length) {
    const set = new Set(countries.map((c) => c.toUpperCase()));
    list = list.filter((r) => set.has(r.country));
  }
  return list.map((r) => ({
    value: r.value,
    country: r.country,
    label: bilingualGeoLabel(t, `geo.regions.${r.value}`, r.hint),
    hint: r.hint,
  }));
}

export function normalizeAsnInput(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/^AS/, '');
  if (!/^\d+$/.test(s)) return '';
  return `AS${s}`;
}

export function filterGeoOptions(options: GeoOption[], q: string): GeoOption[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return options;
  return options.filter(
    (o) =>
      o.value.toLowerCase().includes(needle) ||
      o.label.toLowerCase().includes(needle) ||
      (o.hint ?? '').toLowerCase().includes(needle),
  );
}

/** Region options filtered by selected countries (English labels — use getGeoRegions(t, …)) */
export function regionsForCountries(countries: string[]): GeoRegionOption[] {
  return getGeoRegions(undefined, countries);
}
