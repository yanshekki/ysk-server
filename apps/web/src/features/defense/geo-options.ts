/**
 * Selectable options for IP access policy (country / continent / ASN).
 */

export type GeoOption = { value: string; label: string; hint?: string };

/** Continent / 大陸（Phase1 地區） */
export const GEO_CONTINENTS: GeoOption[] = [
  { value: 'AS', label: '亞洲', hint: 'Asia' },
  { value: 'EU', label: '歐洲', hint: 'Europe' },
  { value: 'NA', label: '北美洲', hint: 'North America' },
  { value: 'SA', label: '南美洲', hint: 'South America' },
  { value: 'AF', label: '非洲', hint: 'Africa' },
  { value: 'OC', label: '大洋洲', hint: 'Oceania' },
  { value: 'AN', label: '南極洲', hint: 'Antarctica' },
];

/** Common countries — ISO + 中文名（可搜尋） */
export const GEO_COUNTRIES: GeoOption[] = [
  { value: 'CN', label: '中國', hint: 'China' },
  { value: 'HK', label: '香港', hint: 'Hong Kong' },
  { value: 'MO', label: '澳門', hint: 'Macao' },
  { value: 'TW', label: '台灣', hint: 'Taiwan' },
  { value: 'JP', label: '日本', hint: 'Japan' },
  { value: 'KR', label: '南韓', hint: 'South Korea' },
  { value: 'KP', label: '北韓', hint: 'North Korea' },
  { value: 'SG', label: '新加坡', hint: 'Singapore' },
  { value: 'MY', label: '馬來西亞', hint: 'Malaysia' },
  { value: 'TH', label: '泰國', hint: 'Thailand' },
  { value: 'VN', label: '越南', hint: 'Vietnam' },
  { value: 'PH', label: '菲律賓', hint: 'Philippines' },
  { value: 'ID', label: '印尼', hint: 'Indonesia' },
  { value: 'IN', label: '印度', hint: 'India' },
  { value: 'AU', label: '澳洲', hint: 'Australia' },
  { value: 'NZ', label: '紐西蘭', hint: 'New Zealand' },
  { value: 'US', label: '美國', hint: 'United States' },
  { value: 'CA', label: '加拿大', hint: 'Canada' },
  { value: 'MX', label: '墨西哥', hint: 'Mexico' },
  { value: 'BR', label: '巴西', hint: 'Brazil' },
  { value: 'AR', label: '阿根廷', hint: 'Argentina' },
  { value: 'GB', label: '英國', hint: 'United Kingdom' },
  { value: 'IE', label: '愛爾蘭', hint: 'Ireland' },
  { value: 'DE', label: '德國', hint: 'Germany' },
  { value: 'FR', label: '法國', hint: 'France' },
  { value: 'NL', label: '荷蘭', hint: 'Netherlands' },
  { value: 'BE', label: '比利時', hint: 'Belgium' },
  { value: 'CH', label: '瑞士', hint: 'Switzerland' },
  { value: 'AT', label: '奧地利', hint: 'Austria' },
  { value: 'SE', label: '瑞典', hint: 'Sweden' },
  { value: 'NO', label: '挪威', hint: 'Norway' },
  { value: 'DK', label: '丹麥', hint: 'Denmark' },
  { value: 'FI', label: '芬蘭', hint: 'Finland' },
  { value: 'PL', label: '波蘭', hint: 'Poland' },
  { value: 'CZ', label: '捷克', hint: 'Czechia' },
  { value: 'ES', label: '西班牙', hint: 'Spain' },
  { value: 'PT', label: '葡萄牙', hint: 'Portugal' },
  { value: 'IT', label: '意大利', hint: 'Italy' },
  { value: 'RU', label: '俄羅斯', hint: 'Russia' },
  { value: 'UA', label: '烏克蘭', hint: 'Ukraine' },
  { value: 'TR', label: '土耳其', hint: 'Turkey' },
  { value: 'IL', label: '以色列', hint: 'Israel' },
  { value: 'AE', label: '阿聯酋', hint: 'UAE' },
  { value: 'SA', label: '沙特', hint: 'Saudi Arabia' },
  { value: 'EG', label: '埃及', hint: 'Egypt' },
  { value: 'ZA', label: '南非', hint: 'South Africa' },
  { value: 'NG', label: '尼日利亞', hint: 'Nigeria' },
  { value: 'PK', label: '巴基斯坦', hint: 'Pakistan' },
  { value: 'BD', label: '孟加拉', hint: 'Bangladesh' },
  { value: 'IR', label: '伊朗', hint: 'Iran' },
  { value: 'IQ', label: '伊拉克', hint: 'Iraq' },
  { value: 'RO', label: '羅馬尼亞', hint: 'Romania' },
  { value: 'BG', label: '保加利亞', hint: 'Bulgaria' },
  { value: 'HU', label: '匈牙利', hint: 'Hungary' },
  { value: 'GR', label: '希臘', hint: 'Greece' },
  { value: 'LT', label: '立陶宛', hint: 'Lithuania' },
  { value: 'LV', label: '拉脫維亞', hint: 'Latvia' },
  { value: 'EE', label: '愛沙尼亞', hint: 'Estonia' },
  { value: 'BY', label: '白俄羅斯', hint: 'Belarus' },
  { value: 'KZ', label: '哈薩克', hint: 'Kazakhstan' },
  { value: 'UZ', label: '烏茲別克', hint: 'Uzbekistan' },
  { value: 'CL', label: '智利', hint: 'Chile' },
  { value: 'CO', label: '哥倫比亞', hint: 'Colombia' },
  { value: 'PE', label: '秘魯', hint: 'Peru' },
  { value: 'VE', label: '委內瑞拉', hint: 'Venezuela' },
  { value: 'CU', label: '古巴', hint: 'Cuba' },
  { value: 'SC', label: '塞舌爾', hint: 'Seychelles' },
  { value: 'PA', label: '巴拿馬', hint: 'Panama' },
];

/** Common network providers (ASN) for multi-select */
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
  { value: 'AS4134', label: 'Chinanet / 電信', hint: 'AS4134' },
  { value: 'AS4837', label: 'China Unicom / 聯通', hint: 'AS4837' },
  { value: 'AS9808', label: 'China Mobile / 移動', hint: 'AS9808' },
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

/** Region options (country-regionKey) for free-tier province/state policy */
export type GeoRegionOption = GeoOption & { country: string };

export const GEO_REGIONS: GeoRegionOption[] = [
  // China
  { value: 'CN-BJ', label: '北京', country: 'CN', hint: 'Beijing' },
  { value: 'CN-SH', label: '上海', country: 'CN', hint: 'Shanghai' },
  { value: 'CN-TJ', label: '天津', country: 'CN', hint: 'Tianjin' },
  { value: 'CN-CQ', label: '重慶', country: 'CN', hint: 'Chongqing' },
  { value: 'CN-GD', label: '廣東', country: 'CN', hint: 'Guangdong' },
  { value: 'CN-ZJ', label: '浙江', country: 'CN', hint: 'Zhejiang' },
  { value: 'CN-JS', label: '江蘇', country: 'CN', hint: 'Jiangsu' },
  { value: 'CN-SD', label: '山東', country: 'CN', hint: 'Shandong' },
  { value: 'CN-HN', label: '河南', country: 'CN', hint: 'Henan' },
  { value: 'CN-HB', label: '湖北', country: 'CN', hint: 'Hubei' },
  { value: 'CN-HU', label: '湖南', country: 'CN', hint: 'Hunan' },
  { value: 'CN-SC', label: '四川', country: 'CN', hint: 'Sichuan' },
  { value: 'CN-HE', label: '河北', country: 'CN', hint: 'Hebei' },
  { value: 'CN-FJ', label: '福建', country: 'CN', hint: 'Fujian' },
  { value: 'CN-AH', label: '安徽', country: 'CN', hint: 'Anhui' },
  { value: 'CN-JX', label: '江西', country: 'CN', hint: 'Jiangxi' },
  { value: 'CN-LN', label: '遼寧', country: 'CN', hint: 'Liaoning' },
  { value: 'CN-JL', label: '吉林', country: 'CN', hint: 'Jilin' },
  { value: 'CN-HL', label: '黑龍江', country: 'CN', hint: 'Heilongjiang' },
  { value: 'CN-SX', label: '山西', country: 'CN', hint: 'Shanxi' },
  { value: 'CN-SN', label: '陝西', country: 'CN', hint: 'Shaanxi' },
  { value: 'CN-GS', label: '甘肅', country: 'CN', hint: 'Gansu' },
  { value: 'CN-QH', label: '青海', country: 'CN', hint: 'Qinghai' },
  { value: 'CN-HA', label: '海南', country: 'CN', hint: 'Hainan' },
  { value: 'CN-YN', label: '雲南', country: 'CN', hint: 'Yunnan' },
  { value: 'CN-GZ', label: '貴州', country: 'CN', hint: 'Guizhou' },
  { value: 'CN-GX', label: '廣西', country: 'CN', hint: 'Guangxi' },
  { value: 'CN-NX', label: '寧夏', country: 'CN', hint: 'Ningxia' },
  { value: 'CN-XJ', label: '新疆', country: 'CN', hint: 'Xinjiang' },
  { value: 'CN-XZ', label: '西藏', country: 'CN', hint: 'Tibet' },
  { value: 'CN-NM', label: '內蒙古', country: 'CN', hint: 'Inner Mongolia' },
  // Taiwan / HK / MO as regions under own country codes often
  { value: 'TW-TPE', label: '台北', country: 'TW', hint: 'Taipei' },
  { value: 'TW-TXG', label: '台中', country: 'TW', hint: 'Taichung' },
  { value: 'TW-KHH', label: '高雄', country: 'TW', hint: 'Kaohsiung' },
  { value: 'HK-HK', label: '香港', country: 'HK', hint: 'Hong Kong' },
  { value: 'MO-MO', label: '澳門', country: 'MO', hint: 'Macao' },
  // US states (subset + common)
  { value: 'US-CA', label: 'California', country: 'US', hint: 'CA' },
  { value: 'US-NY', label: 'New York', country: 'US', hint: 'NY' },
  { value: 'US-TX', label: 'Texas', country: 'US', hint: 'TX' },
  { value: 'US-FL', label: 'Florida', country: 'US', hint: 'FL' },
  { value: 'US-WA', label: 'Washington', country: 'US', hint: 'WA' },
  { value: 'US-IL', label: 'Illinois', country: 'US', hint: 'IL' },
  { value: 'US-VA', label: 'Virginia', country: 'US', hint: 'VA' },
  { value: 'US-OR', label: 'Oregon', country: 'US', hint: 'OR' },
  { value: 'US-GA', label: 'Georgia', country: 'US', hint: 'GA' },
  { value: 'US-NJ', label: 'New Jersey', country: 'US', hint: 'NJ' },
  { value: 'US-MA', label: 'Massachusetts', country: 'US', hint: 'MA' },
  { value: 'US-OH', label: 'Ohio', country: 'US', hint: 'OH' },
  { value: 'US-PA', label: 'Pennsylvania', country: 'US', hint: 'PA' },
  { value: 'US-AZ', label: 'Arizona', country: 'US', hint: 'AZ' },
  { value: 'US-CO', label: 'Colorado', country: 'US', hint: 'CO' },
  { value: 'US-NC', label: 'North Carolina', country: 'US', hint: 'NC' },
  { value: 'US-MI', label: 'Michigan', country: 'US', hint: 'MI' },
  { value: 'US-NV', label: 'Nevada', country: 'US', hint: 'NV' },
  // JP
  { value: 'JP-13', label: '東京', country: 'JP', hint: 'Tokyo' },
  { value: 'JP-27', label: '大阪', country: 'JP', hint: 'Osaka' },
  { value: 'JP-14', label: '神奈川', country: 'JP', hint: 'Kanagawa' },
  { value: 'JP-23', label: '愛知', country: 'JP', hint: 'Aichi' },
  // KR
  { value: 'KR-11', label: '首爾', country: 'KR', hint: 'Seoul' },
  { value: 'KR-26', label: '釜山', country: 'KR', hint: 'Busan' },
  // SG / AU / GB / DE / RU sample
  { value: 'SG-01', label: 'Singapore', country: 'SG', hint: 'SG' },
  { value: 'AU-NSW', label: 'New South Wales', country: 'AU', hint: 'NSW' },
  { value: 'AU-VIC', label: 'Victoria', country: 'AU', hint: 'VIC' },
  { value: 'GB-ENG', label: 'England', country: 'GB', hint: 'ENG' },
  { value: 'DE-BE', label: 'Berlin', country: 'DE', hint: 'BE' },
  { value: 'DE-BY', label: 'Bayern', country: 'DE', hint: 'BY' },
  { value: 'RU-MOW', label: 'Moscow', country: 'RU', hint: 'MOW' },
  { value: 'RU-SPE', label: 'St Petersburg', country: 'RU', hint: 'SPE' },
];

export function regionsForCountries(countries: string[]): GeoRegionOption[] {
  if (!countries.length) return GEO_REGIONS;
  const set = new Set(countries.map((c) => c.toUpperCase()));
  return GEO_REGIONS.filter((r) => set.has(r.country));
}
