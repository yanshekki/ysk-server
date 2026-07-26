/**
 * Multi-list DNSBL (blacklist) checks for outbound mail IP reputation (Spec §5.4 D).
 */

import { resolve4 } from 'node:dns/promises';

export interface DnsblListResult {
  list: string;
  listed: boolean;
  detail: string;
  query: string;
}

export interface DnsblReport {
  ok: boolean;
  ip: string;
  listedOn: string[];
  cleanOn: string[];
  results: DnsblListResult[];
  notes: string[];
}

/** Common public DNSBL zones used for outbound IP reputation. */
export const DEFAULT_DNSBL_ZONES = [
  'zen.spamhaus.org',
  'bl.spamcop.net',
  'b.barracudacentral.org',
  'dnsbl.sorbs.net',
  'psbl.surriel.com',
  'ubl.unsubscore.com',
] as const;

/**
 * Reverse IPv4 for DNSBL query (e.g. 1.2.3.4 → 4.3.2.1).
 */
export function reverseIpv4(ip: string): string | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  return parts.reverse().join('.');
}

/**
 * Check a single DNSBL zone. A successful A record usually means listed
 * (or policy response). NXDOMAIN / errors → treat as not listed.
 */
export async function checkDnsblZone(
  ip: string,
  zone: string,
  resolve: typeof resolve4 = resolve4,
): Promise<DnsblListResult> {
  const rev = reverseIpv4(ip);
  if (!rev) {
    return {
      list: zone,
      listed: false,
      detail: 'invalid IPv4',
      query: '',
    };
  }
  const query = `${rev}.${zone}`;
  try {
    const addrs = await resolve(query);
    return {
      list: zone,
      listed: true,
      detail: `LISTED (A ${addrs.join(', ')})`,
      query,
    };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return {
        list: zone,
        listed: false,
        detail: 'not listed',
        query,
      };
    }
    return {
      list: zone,
      listed: false,
      detail: `query error: ${e instanceof Error ? e.message : String(e)}`,
      query,
    };
  }
}

/**
 * Run multi-list DNSBL checks for an IP.
 */
export async function checkIpDnsbl(
  ip: string,
  zones: readonly string[] = DEFAULT_DNSBL_ZONES,
  resolve: typeof resolve4 = resolve4,
): Promise<DnsblReport> {
  const results: DnsblListResult[] = [];
  for (const zone of zones) {
    results.push(await checkDnsblZone(ip, zone, resolve));
  }
  const listedOn = results.filter((r) => r.listed).map((r) => r.list);
  const cleanOn = results.filter((r) => !r.listed).map((r) => r.list);
  const notes =
    listedOn.length > 0
      ? [
          `IP ${ip} appears listed on: ${listedOn.join(', ')}`,
          'Request delisting at the DNSBL operator; avoid bulk mail until clean',
        ]
      : [`IP ${ip} not listed on ${zones.length} checked DNSBLs`];
  return {
    ok: listedOn.length === 0,
    ip,
    listedOn,
    cleanOn,
    results,
    notes,
  };
}

/**
 * Check multiple IPs against DNSBL zones (RBL depth for multi-homed hosts).
 */
export async function checkMultipleIpsDnsbl(
  ips: string[],
  zones: readonly string[] = DEFAULT_DNSBL_ZONES,
  resolve: typeof resolve4 = resolve4,
): Promise<{
  ok: boolean;
  reports: DnsblReport[];
  listedIps: string[];
  notes: string[];
}> {
  const unique = [...new Set(ips.map((i) => i.trim()).filter(Boolean))].slice(0, 10);
  const reports: DnsblReport[] = [];
  for (const ip of unique) {
    reports.push(await checkIpDnsbl(ip, zones, resolve));
  }
  const listedIps = reports.filter((r) => !r.ok).map((r) => r.ip);
  return {
    ok: listedIps.length === 0,
    reports,
    listedIps,
    notes: [
      `Checked ${unique.length} IP(s) × ${zones.length} lists`,
      listedIps.length
        ? `Listed: ${listedIps.join(', ')}`
        : 'All checked IPs clean on configured lists',
    ],
  };
}
