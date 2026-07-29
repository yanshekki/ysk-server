/**
 * Dual-stack IP utilities — single source of truth for IPv4 + IPv6.
 * Prefer Node `net.isIP` / `net.BlockList`; no third-party IP libs.
 */

import { isIP, BlockList } from 'node:net';

export type IpFamily = 4 | 6;

/** Reject zone-id (fe80::1%eth0) and empty. */
function stripAndRejectZone(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.includes('%')) return null;
  // Strip optional surrounding brackets used in URLs: [2001:db8::1]
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1);
    if (!inner || inner.includes('%')) return null;
    return inner;
  }
  return s;
}

/**
 * IPv4-mapped IPv6 → plain IPv4 (e.g. ::ffff:203.0.113.1 → 203.0.113.1).
 */
function unmapV4Mapped(ip: string): string {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const rest = ip.slice(7);
    if (isIP(rest) === 4) return rest;
    // dotted form after ::ffff: already handled; hex form ::ffff:c000:0201 rare — leave to isIP
  }
  return ip;
}

export function ipFamily(ip: string): IpFamily | 0 {
  const s = stripAndRejectZone(ip);
  if (!s) return 0;
  const n = isIP(unmapV4Mapped(s));
  return n === 4 || n === 6 ? n : 0;
}

export function isValidIp(ip: string): boolean {
  return ipFamily(ip) !== 0;
}

/**
 * Normalize for storage / comparison.
 * - trims, strips [] 
 * - rejects zone id
 * - unmaps IPv4-mapped IPv6
 * - lowercases IPv6 hex (Node does not expand; equality uses BlockList / family-aware compare)
 */
export function normalizeIp(ip: string): string | null {
  const s = stripAndRejectZone(ip);
  if (!s) return null;
  const unmapped = unmapV4Mapped(s);
  const fam = isIP(unmapped);
  if (fam === 4) return unmapped;
  if (fam === 6) return unmapped.toLowerCase();
  return null;
}

export function isValidCidr(cidr: string): boolean {
  return normalizeIpOrCidr(cidr) !== null && cidr.trim().includes('/');
}

export function isValidIpOrCidr(s: string): boolean {
  return normalizeIpOrCidr(s) !== null;
}

/**
 * Normalize IP or CIDR. Returns `addr` or `addr/prefix` or null.
 */
export function normalizeIpOrCidr(raw: string): string | null {
  const s = stripAndRejectZone(raw);
  if (!s) return null;
  if (!s.includes('/')) {
    return normalizeIp(s);
  }
  const slash = s.lastIndexOf('/');
  const base = s.slice(0, slash);
  const bitsStr = s.slice(slash + 1);
  if (!/^\d{1,3}$/.test(bitsStr)) return null;
  const bits = Number(bitsStr);
  const normBase = normalizeIp(base);
  if (!normBase) return null;
  const fam = isIP(normBase);
  if (fam === 4) {
    if (bits < 0 || bits > 32) return null;
    return `${normBase}/${bits}`;
  }
  if (fam === 6) {
    if (bits < 0 || bits > 128) return null;
    return `${normBase}/${bits}`;
  }
  return null;
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}

function ipv4InCidr(ip: string, base: string, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** Expand IPv6 to 8×16-bit groups (for CIDR mask when BlockList fails). */
function ipv6ToGroups(ip: string): number[] | null {
  // Use URL parser trick: new URL('http://[ip]/') 
  // Prefer manual expand for compressed forms
  let s = ip.toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (s.includes('.')) {
    // v4-mapped already unmapped before call
    return null;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  if (halves.length === 1) {
    if (left.length !== 8) return null;
  } else {
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    const mid = Array.from({ length: missing }, () => '0');
    const full = [...left, ...mid, ...right];
    if (full.length !== 8) return null;
    return full.map((g) => {
      const n = parseInt(g, 16);
      return Number.isFinite(n) && n >= 0 && n <= 0xffff ? n : -1;
    }).every((n) => n >= 0)
      ? full.map((g) => parseInt(g, 16))
      : null;
  }
  const nums = left.map((g) => parseInt(g, 16));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

function ipv6GroupsToBigInt(groups: number[]): bigint {
  let x = 0n;
  for (const g of groups) {
    x = (x << 16n) + BigInt(g);
  }
  return x;
}

function ipv6InCidr(ip: string, base: string, bits: number): boolean {
  if (bits === 0) return true;
  const ig = ipv6ToGroups(ip);
  const bg = ipv6ToGroups(base);
  if (!ig || !bg) {
    // Fallback: BlockList
    try {
      const bl = new BlockList();
      bl.addSubnet(base, bits, 'ipv6');
      return bl.check(ip, 'ipv6');
    } catch {
      return false;
    }
  }
  const mask =
    bits >= 128 ? (1n << 128n) - 1n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  const a = ipv6GroupsToBigInt(ig);
  const b = ipv6GroupsToBigInt(bg);
  return (a & mask) === (b & mask);
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const nIp = normalizeIp(ip);
  const nCidr = normalizeIpOrCidr(cidr);
  if (!nIp || !nCidr || !nCidr.includes('/')) return false;
  const slash = nCidr.lastIndexOf('/');
  const base = nCidr.slice(0, slash);
  const bits = Number(nCidr.slice(slash + 1));
  const famIp = isIP(nIp);
  const famBase = isIP(base);
  if (!famIp || famIp !== famBase) return false;
  if (famIp === 4) return ipv4InCidr(nIp, base, bits);
  return ipv6InCidr(nIp, base, bits);
}

/**
 * Exact match (normalized) or CIDR membership.
 */
export function ipMatchesList(ip: string, list: string[]): boolean {
  const nIp = normalizeIp(ip);
  if (!nIp) return false;
  for (const raw of list) {
    const rule = normalizeIpOrCidr(raw);
    if (!rule) continue;
    if (!rule.includes('/')) {
      if (rule === nIp) return true;
      continue;
    }
    if (ipInCidr(nIp, rule)) return true;
  }
  return false;
}

export function isPrivateOrLocalIp(ip: string): boolean {
  const n = normalizeIp(ip);
  if (!n) return false;
  const fam = isIP(n);
  if (fam === 4) {
    if (n === '0.0.0.0' || n === '127.0.0.1') return true;
    if (n.startsWith('10.') || n.startsWith('192.168.') || n.startsWith('169.254.')) return true;
    if (n.startsWith('127.')) return true;
    const m = /^172\.(\d+)\./.exec(n);
    if (m) {
      const o = Number(m[1]);
      if (o >= 16 && o <= 31) return true;
    }
    return false;
  }
  if (fam === 6) {
    if (n === '::1' || n === '::') return true;
    // link-local fe80::/10
    if (n.startsWith('fe8') || n.startsWith('fe9') || n.startsWith('fea') || n.startsWith('feb'))
      return true;
    // ULA fc00::/7 → fc… / fd…
    if (n.startsWith('fc') || n.startsWith('fd')) return true;
    // Unique local and loopback already; also IPv4-mapped private handled via unmap
    return false;
  }
  return false;
}

const IPV4_RE = /\b((?:\d{1,3}\.){3}\d{1,3})\b/g;

/**
 * Extract IPs from a log line. Prefers leading field (nginx combined).
 * Validates with isIP; skips obvious non-addresses.
 */
export function extractIpsFromText(line: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const n = normalizeIp(raw);
    if (!n || seen.has(n)) return;
    // skip 0.x noise sometimes
    if (n.startsWith('0.')) return;
    seen.add(n);
    found.push(n);
  };

  // Leading token (common for access logs)
  const lead = line.match(/^(\S+)/);
  if (lead) {
    const t = lead[1].replace(/^\[|\]$/g, '');
    if (isValidIp(t)) push(t);
  }

  // All IPv4
  let m: RegExpExecArray | null;
  const re4 = new RegExp(IPV4_RE.source, 'g');
  while ((m = re4.exec(line)) !== null) {
    if (isIP(m[1]) === 4) push(m[1]);
  }

  // IPv6 candidates: sequences with colons (not timestamps alone)
  // Match compressed/full hex groups
  const re6 =
    /(?:^|[\s\[,;"])((?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}|::1|::)(?=[\s\],;"]|$)/g;
  while ((m = re6.exec(line)) !== null) {
    const cand = m[1];
    if (cand.includes('.') && !cand.toLowerCase().includes('::ffff:')) continue;
    if (isIP(cand) === 6) push(cand);
  }

  return found;
}

/** First non-private IPv4/IPv6 from line (for ban deep-link). */
export function extractIpFromLogLine(line: string): string | null {
  for (const ip of extractIpsFromText(line)) {
    if (!isPrivateOrLocalIp(ip)) return ip;
  }
  return null;
}

/**
 * DNSBL reverse name (RFC 5782 for IPv6 nibble form).
 * IPv4: 1.2.3.4 → 4.3.2.1
 * IPv6: expand to 32 nibbles reversed.
 */
export function reverseDnsblName(ip: string): string | null {
  const n = normalizeIp(ip);
  if (!n) return null;
  if (isIP(n) === 4) {
    return n.split('.').reverse().join('.');
  }
  if (isIP(n) === 6) {
    const groups = ipv6ToGroups(n);
    if (!groups) return null;
    const nibbles: string[] = [];
    for (const g of groups) {
      const hex = g.toString(16).padStart(4, '0');
      for (const ch of hex) nibbles.push(ch);
    }
    return nibbles.reverse().join('.');
  }
  return null;
}
