/**
 * SSRF guards for server-side fetch (CDN health, LLM base URLs, etc.).
 * Fail closed for private / link-local / metadata targets unless explicitly allowed.
 */

import { ErrorCodes, YskError, tl } from '@ysk/shared';
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
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/** Cloud metadata + loopback — always dangerous for SSRF. */
export function isMetadataOrLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.endsWith('.localhost')) return true;
  if (h === '::1') return true;
  const p = ipv4Parts(h);
  if (p) {
    const [a, b] = p;
    if (a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / IMDS
  }
  if (isIP(h) === 6) {
    const s = h.toLowerCase();
    if (s.startsWith('fe80')) return true;
  }
  return false;
}

/** RFC1918 + CGNAT + ULA (not loopback/IMDS). */
export function isRfc1918Host(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
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
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
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
