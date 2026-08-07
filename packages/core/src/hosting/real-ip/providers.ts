/**
 * CDN / edge provider catalog + bundled CIDR snapshots.
 * Snapshots are best-effort; use refresh() for up-to-date lists.
 */

import type { RealIpProviderDef, RealIpProviderId } from './types.js';

/** Cloudflare IPv4 (snapshot; matches prior YSK hardcode + common ranges). */
const CF_V4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

const CF_V6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/** Fastly public IP ranges (snapshot sample — refresh for full list). */
const FASTLY_V4 = [
  '23.235.32.0/20',
  '43.249.72.0/22',
  '103.244.50.0/24',
  '103.245.222.0/23',
  '103.245.224.0/24',
  '104.156.80.0/20',
  '140.248.64.0/18',
  '146.75.0.0/17',
  '151.101.0.0/16',
  '157.52.64.0/18',
  '167.82.0.0/17',
  '167.82.128.0/20',
  '167.82.160.0/20',
  '167.82.224.0/20',
  '172.111.64.0/18',
  '185.31.16.0/22',
  '199.27.72.0/21',
  '199.232.0.0/16',
];

const FASTLY_V6 = ['2a04:4e40::/32', '2a04:4e42::/32'];

/** BunnyCDN (snapshot). */
const BUNNY_V4 = [
  '84.17.32.0/19',
  '89.187.160.0/19',
  '103.233.192.0/22',
  '107.181.160.0/19',
  '185.93.0.0/22',
  '185.152.64.0/22',
  '185.234.100.0/22',
  '193.37.0.0/22',
];

/** CloudFront — common prefixes (full list via Amazon ip-ranges refresh). */
const CLOUDFRONT_V4 = [
  '13.32.0.0/15',
  '13.35.0.0/16',
  '13.224.0.0/14',
  '13.249.0.0/16',
  '18.64.0.0/14',
  '18.68.0.0/16',
  '52.46.0.0/18',
  '52.84.0.0/15',
  '52.222.128.0/17',
  '54.182.0.0/16',
  '54.192.0.0/16',
  '54.230.0.0/16',
  '54.239.128.0/18',
  '64.252.64.0/18',
  '70.132.0.0/18',
  '71.152.0.0/17',
  '99.84.0.0/16',
  '99.86.0.0/16',
  '143.204.0.0/16',
  '204.246.164.0/22',
  '204.246.168.0/22',
  '205.251.192.0/19',
  '205.251.249.0/24',
  '205.251.250.0/23',
  '205.251.252.0/23',
  '205.251.254.0/24',
  '216.137.32.0/19',
];

const AZURE_FD_V4 = [
  '13.73.248.16/29',
  '20.21.37.40/29',
  '20.36.120.104/29',
  '20.37.156.216/29',
  '20.37.195.96/27',
  '20.38.85.152/29',
  '20.39.13.96/27',
  '20.41.6.0/24',
  '20.42.4.208/28',
  '20.42.37.40/29',
  '20.43.54.0/27',
  '20.43.65.128/27',
  '20.43.130.80/28',
  '20.49.102.0/24',
  '20.150.160.0/23',
  '20.189.107.0/24',
  '40.67.48.80/28',
  '40.90.136.208/29',
  '51.12.73.136/29',
  '51.104.28.0/24',
  '51.137.160.152/29',
  '52.149.104.0/21',
  '52.150.136.80/29',
  '52.159.212.184/29',
  '52.228.80.128/25',
  '147.243.0.0/16',
];

const GCORE_V4 = [
  '92.223.0.0/17',
  '92.223.128.0/18',
  '138.124.184.0/21',
  '152.89.248.0/21',
  '185.59.220.0/22',
  '213.156.152.0/21',
];

export const REAL_IP_PROVIDERS: RealIpProviderDef[] = [
  {
    id: 'none',
    label: 'None (direct origin)',
    clientIpHeader: '',
    snapshotIpv4: [],
    snapshotIpv6: [],
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    clientIpHeader: 'CF-Connecting-IP',
    cidrSources: {
      ipv4: 'https://www.cloudflare.com/ips-v4',
      ipv6: 'https://www.cloudflare.com/ips-v6',
    },
    snapshotIpv4: CF_V4,
    snapshotIpv6: CF_V6,
  },
  {
    id: 'fastly',
    label: 'Fastly',
    clientIpHeader: 'Fastly-Client-IP',
    cidrSources: {
      ipv4: 'https://api.fastly.com/public-ip-list',
    },
    snapshotIpv4: FASTLY_V4,
    snapshotIpv6: FASTLY_V6,
  },
  {
    id: 'bunny',
    label: 'Bunny CDN',
    clientIpHeader: 'X-Forwarded-For',
    snapshotIpv4: BUNNY_V4,
    snapshotIpv6: [],
  },
  {
    id: 'cloudfront',
    label: 'AWS CloudFront',
    clientIpHeader: 'X-Forwarded-For',
    cidrSources: {
      ipv4: 'https://ip-ranges.amazonaws.com/ip-ranges.json',
    },
    snapshotIpv4: CLOUDFRONT_V4,
    snapshotIpv6: [],
  },
  {
    id: 'azure_frontdoor',
    label: 'Azure Front Door',
    clientIpHeader: 'X-Azure-ClientIP',
    snapshotIpv4: AZURE_FD_V4,
    snapshotIpv6: [],
  },
  {
    id: 'gcore',
    label: 'Gcore CDN',
    clientIpHeader: 'X-Forwarded-For',
    snapshotIpv4: GCORE_V4,
    snapshotIpv6: [],
  },
  {
    id: 'custom',
    label: 'Custom proxies',
    clientIpHeader: 'X-Forwarded-For',
    snapshotIpv4: [],
    snapshotIpv6: [],
  },
];

export function getRealIpProvider(id: RealIpProviderId): RealIpProviderDef {
  return REAL_IP_PROVIDERS.find((p) => p.id === id) ?? REAL_IP_PROVIDERS[0];
}

export function listRealIpProviders(): RealIpProviderDef[] {
  return REAL_IP_PROVIDERS.map((p) => ({ ...p }));
}

/** Loose CIDR / IP validation for config input. */
export function isValidCidrOrIp(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 64) return false;
  // IPv4 or IPv4/prefix
  if (/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(t)) return true;
  // IPv6 rough
  if (/^[0-9a-fA-F:]+(\/\d{1,3})?$/.test(t) && t.includes(':')) return true;
  return false;
}

export function normalizeCidrList(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    if (!isValidCidrOrIp(t)) continue;
    if (seen.has(t)) continue;
    // Reject trust-all
    if (t === '0.0.0.0/0' || t === '::/0') continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
