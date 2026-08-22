/**
 * Detect host WAN IPv4/IPv6. Fail-closed: never return RFC1918 / CGNAT / empty.
 * Probe hosts match VPN + validators (ifconfig.me, ident.me, ipify).
 */
import { isIpv4, isIpv6 } from 'ysk-server-shared';

export type PublicIpFetch = (url: string, timeoutMs: number) => Promise<string>;

const V4_URLS = [
  'https://ifconfig.me/ip',
  'https://ident.me',
  'https://api.ipify.org',
] as const;

const V6_URLS = ['https://api6.ipify.org', 'https://v6.ident.me'] as const;

export function isCgnatIpv4(ip: string): boolean {
  const p = ip.split('.').map((x) => Number(x));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  return p[0] === 100 && p[1]! >= 64 && p[1]! <= 127;
}

export function isPublicIpv4(ip: string): boolean {
  if (!isIpv4(ip)) return false;
  const p = ip.split('.').map((x) => Number(x));
  const a = p[0]!;
  const b = p[1]!;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (isCgnatIpv4(ip)) return false;
  if (a >= 224) return false;
  return true;
}

export function isPublicIpv6(ip: string): boolean {
  const s = ip.trim().toLowerCase();
  if (!isIpv6(s)) return false;
  if (s === '::' || s === '::1') return false;
  if (s.startsWith('fe80:')) return false;
  if (s.startsWith('fc') || s.startsWith('fd')) return false;
  if (s.startsWith('::ffff:')) {
    const mapped = s.slice('::ffff:'.length);
    if (isIpv4(mapped)) return isPublicIpv4(mapped);
  }
  return true;
}

function defaultFetch(url: string, timeoutMs: number): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(url, { signal: ac.signal, headers: { accept: 'text/plain' } })
    .then(async (res) => {
      if (!res.ok) return '';
      return (await res.text()).trim().split(/\s+/)[0] ?? '';
    })
    .catch(() => '')
    .finally(() => clearTimeout(t));
}

export async function detectPublicIpv4(
  fetchImpl: PublicIpFetch = defaultFetch,
  timeoutMs = 5_000,
): Promise<{ ip: string | null; error: string | null }> {
  let sawPrivate: string | null = null;
  for (const url of V4_URLS) {
    const raw = (await fetchImpl(url, timeoutMs)).trim();
    if (isPublicIpv4(raw)) return { ip: raw, error: null };
    if (raw && isIpv4(raw)) sawPrivate = raw;
  }
  return {
    ip: null,
    error: sawPrivate ? 'notPublicIpv4' : 'probeFailed',
  };
}

export async function detectPublicIpv6(
  fetchImpl: PublicIpFetch = defaultFetch,
  timeoutMs = 5_000,
): Promise<{ ip: string | null; error: string | null }> {
  let sawPrivate: string | null = null;
  for (const url of V6_URLS) {
    const raw = (await fetchImpl(url, timeoutMs)).trim();
    if (isPublicIpv6(raw)) return { ip: raw, error: null };
    if (raw && isIpv6(raw)) sawPrivate = raw;
  }
  return {
    ip: null,
    error: sawPrivate ? 'notPublicIpv6' : 'probeFailed',
  };
}
