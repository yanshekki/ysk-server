/**
 * SSRF guards for server-side fetch (CDN health, LLM base URLs, etc.).
 * Fail closed for private / link-local / metadata targets unless explicitly allowed.
 */

import { ErrorCodes, YskError, tl } from 'ysk-server-shared';
import { isIP } from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

function ipv4Parts(ip: string): [number, number, number, number] | null {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return [a, b, c, d];
}

/** Strip URL brackets and decode IPv4-mapped / IPv4-compatible IPv6. */
export function canonicalizeSsrfHost(host: string): string {
  let h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const mappedDotted = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return mappedDotted[1]!;
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  const compat = h.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (compat) return compat[1]!;
  return h;
}

function isAlwaysImdsHost(h: string): boolean {
  if (h === '100.100.100.200') return true; // Alibaba
  if (h === 'fd00:ec2::254' || h === 'fd00:ec2::ff' || h.startsWith('fd00:ec2:')) return true;
  return false;
}

/** True when hostname is loopback (not a substring match on the full URL). */
export function isLoopbackHostname(host: string): boolean {
  const raw = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const h = canonicalizeSsrfHost(raw);
  if (!h) return false;
  if (h === 'localhost' || h === 'localhost.localdomain' || raw === 'localhost') return true;
  if (h.endsWith('.localhost') || raw.endsWith('.localhost')) return true;
  if (h === '::1' || raw === '::1') return true;
  const p = ipv4Parts(h);
  if (p && p[0] === 127) return true;
  return false;
}

/** Cloud IMDS / link-local metadata — not loopback (VNC may target 127.0.0.1). */
export function isCloudMetadataHost(host: string): boolean {
  const raw = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const h = canonicalizeSsrfHost(raw);
  if (!h) return true;
  if (h === 'metadata.google.internal' || raw === 'metadata.google.internal') return true;
  if (h === 'metadata' || raw === 'metadata') return true;
  if (isAlwaysImdsHost(h) || isAlwaysImdsHost(raw)) return true;
  const p = ipv4Parts(h);
  if (p) {
    const [a, b] = p;
    if (a === 169 && b === 254) return true;
  }
  if (isIP(h) === 6 && h.startsWith('fe80')) return true;
  return false;
}

/** Cloud metadata + loopback — always dangerous for SSRF. */
export function isMetadataOrLoopbackHost(host: string): boolean {
  const raw = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const h = canonicalizeSsrfHost(raw);
  if (!h) return true;
  if (BLOCKED_HOSTNAMES.has(h) || BLOCKED_HOSTNAMES.has(raw)) return true;
  if (h.endsWith('.localhost') || raw.endsWith('.localhost')) return true;
  if (h === '::1' || raw === '::1') return true;
  if (isCloudMetadataHost(h) || isCloudMetadataHost(raw)) return true;
  const p = ipv4Parts(h);
  if (p) {
    const [a] = p;
    if (a === 127 || a === 0) return true;
  }
  return false;
}

/** RFC1918 + CGNAT + ULA (not loopback/IMDS). */
export function isRfc1918Host(host: string): boolean {
  const h = canonicalizeSsrfHost(host);
  const p = ipv4Parts(h);
  if (p) {
    const [a, b] = p;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  if (isIP(h) === 6) {
    const s = h.toLowerCase();
    if (s.startsWith('fc') || s.startsWith('fd')) return true;
  }
  return false;
}

/**
 * True if host should be blocked under policy:
 * - strict: metadata + loopback + RFC1918
 * - metadata (default for CDN): only metadata + loopback (fleet may use 10.x health)
 */
export function isBlockedSsrfHost(
  host: string,
  policy: 'strict' | 'metadata' = 'strict',
): boolean {
  const h = canonicalizeSsrfHost(host);
  if (!h) return true;
  if (isMetadataOrLoopbackHost(h)) return true;
  if (policy === 'strict') {
    if (h.endsWith('.local') || h.endsWith('.internal')) return true;
    if (isRfc1918Host(h)) return true;
  }
  return false;
}

/**
 * Validate http(s) URL for outbound server fetch.
 * Throws YskError on invalid scheme or blocked host.
 */
export function assertSafeOutboundUrl(
  raw: string,
  opts?: {
    allowPrivate?: boolean;
    /** strict = block RFC1918; metadata = allow 10.x (CDN fleet health) */
    policy?: 'strict' | 'metadata';
    field?: string;
  },
): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0303'), {
      httpStatus: 400,
      details: { field: opts?.field ?? 'url', value: raw.slice(0, 200) },
    });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0303'), {
      httpStatus: 400,
      details: { field: opts?.field ?? 'url', reason: 'scheme' },
    });
  }
  // Unit tests bind ephemeral loopback HTTP servers
  const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  if (
    isTest &&
    (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1')
  ) {
    return u;
  }
  const policy = opts?.policy ?? 'strict';
  if (!opts?.allowPrivate && isBlockedSsrfHost(u.hostname, policy)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0303'), {
      httpStatus: 400,
      details: {
        field: opts?.field ?? 'url',
        reason: 'ssrf_blocked_host',
        host: u.hostname,
        policy,
      },
    });
  }
  return u;
}
