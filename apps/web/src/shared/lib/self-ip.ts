/**
 * Host / login / ignoreip classification so the panel cannot one-click
 * ban its own egress or the operator’s current session.
 */

export type SelfIpKind = 'loopback' | 'host' | 'login' | 'ignore' | null;

export function normalizeIp(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/i, '');
}

export function ipsEqual(a: string, b: string): boolean {
  return normalizeIp(a).toLowerCase() === normalizeIp(b).toLowerCase();
}

export function classifySelfIp(
  ip: string,
  opts: {
    hostIps?: Iterable<string>;
    loginIps?: Iterable<string>;
    ignoreIps?: Iterable<string>;
  },
): SelfIpKind {
  const n = normalizeIp(ip);
  if (!n) return null;
  if (n === '127.0.0.1' || n === '::1' || n.startsWith('127.')) return 'loopback';
  for (const x of opts.loginIps ?? []) {
    if (ipsEqual(n, x)) return 'login';
  }
  for (const x of opts.hostIps ?? []) {
    if (ipsEqual(n, x)) return 'host';
  }
  for (const x of opts.ignoreIps ?? []) {
    const item = normalizeIp(x);
    if (!item) continue;
    if (item.includes('/')) {
      if (n === item.split('/')[0]) return 'ignore';
      continue;
    }
    if (ipsEqual(n, item)) return 'ignore';
  }
  return null;
}

export function isProtectedSelfIp(
  ip: string,
  opts: {
    hostIps?: Iterable<string>;
    loginIps?: Iterable<string>;
    ignoreIps?: Iterable<string>;
  },
): boolean {
  return classifySelfIp(ip, opts) != null;
}

export function collectHostIps(host: {
  network?: {
    ips?: string[];
    interfaces?: Array<{ addrs?: string[] }>;
  };
  identity?: { publicIpv4?: string; announceHost?: string };
} | null | undefined): string[] {
  const out: string[] = [];
  for (const ip of host?.network?.ips ?? []) out.push(normalizeIp(ip));
  for (const iface of host?.network?.interfaces ?? []) {
    for (const a of iface.addrs ?? []) out.push(normalizeIp(a));
  }
  if (host?.identity?.publicIpv4) out.push(normalizeIp(host.identity.publicIpv4));
  return [...new Set(out.filter(Boolean))];
}

export function collectLoginIps(
  sessions: Array<{ ip?: string; current?: boolean }> | null | undefined,
): string[] {
  const cur = (sessions ?? []).filter((s) => s.current && s.ip);
  const src = cur.length ? cur : (sessions ?? []).filter((s) => s.ip);
  return [...new Set(src.map((s) => normalizeIp(s.ip ?? '')).filter(Boolean))];
}
