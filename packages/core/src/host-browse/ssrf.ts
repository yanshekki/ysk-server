/**
 * Host-browse SSRF policy — internet vs intranet modes.
 * Always blocks cloud metadata. DNS rebinding: resolve + check all IPs.
 */

import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { ErrorCodes, YskError } from '@ysk-server/shared';
import {
  isBlockedSsrfHost,
  isMetadataOrLoopbackHost,
  isRfc1918Host,
} from '../net/ssrf.js';
import type { HostBrowseMode } from './types.js';

const DEFAULT_PORTS = new Set([80, 443]);
const INTRANET_EXTRA_PORTS = new Set([
  8080, 8443, 8000, 8888, 9000, 9090, 3000, 5000, 5601, 9200, 15672, 8081, 9443,
]);

export type HostBrowseSsrfOpts = {
  mode: HostBrowseMode;
  allowLoopback?: boolean;
  extraPorts?: number[];
  field?: string;
};

function throwSsrf(message: string, details: Record<string, unknown>): never {
  throw new YskError(ErrorCodes.HOST_BROWSE_SSRF, message, {
    httpStatus: 400,
    details,
  });
}

/** Parse and validate scheme + port before DNS. */
export function parseBrowseUrl(raw: string, field = 'url'): URL {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    throw new YskError(ErrorCodes.VALIDATION, 'URL required', {
      httpStatus: 400,
      details: { field },
    });
  }
  let withScheme = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    withScheme = `https://${trimmed}`;
  }
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new YskError(ErrorCodes.VALIDATION, 'Invalid URL', {
      httpStatus: 400,
      details: { field, value: trimmed.slice(0, 200) },
    });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throwSsrf('Only http and https are allowed', {
      field,
      reason: 'scheme',
      protocol: u.protocol,
    });
  }
  if (u.username || u.password) {
    throwSsrf('URL credentials are not allowed', {
      field,
      reason: 'userinfo',
    });
  }
  return u;
}

function portAllowed(u: URL, opts: HostBrowseSsrfOpts): boolean {
  const port = u.port
    ? Number(u.port)
    : u.protocol === 'https:'
      ? 443
      : 80;
  if (!Number.isFinite(port) || port < 1 || port > 65535) return false;
  if (DEFAULT_PORTS.has(port)) return true;
  const extra = new Set([
    ...(opts.mode === 'intranet' ? INTRANET_EXTRA_PORTS : []),
    ...(opts.extraPorts ?? []),
  ]);
  return extra.has(port);
}

/**
 * Hostname / literal-IP policy for a mode (before or after DNS).
 * - internet: public only
 * - intranet: private/ULA allowed; metadata always blocked; loopback optional
 */
export function isHostAllowedForMode(
  host: string,
  opts: HostBrowseSsrfOpts,
): { ok: boolean; reason?: string } {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return { ok: false, reason: 'empty_host' };

  // Metadata / IMDS always denied
  if (isMetadataOrLoopbackHost(h)) {
    // Loopback may be allowed only in intranet with flag
    if (
      opts.mode === 'intranet' &&
      opts.allowLoopback &&
      (h === '127.0.0.1' ||
        h === 'localhost' ||
        h === '::1' ||
        h.startsWith('127.') ||
        h === 'localhost.localdomain' ||
        h.endsWith('.localhost'))
    ) {
      // still block bare "metadata" hostnames
      if (h.includes('metadata') || h === '169.254.169.254') {
        return { ok: false, reason: 'metadata' };
      }
      // link-local non-loopback still blocked
      if (h.startsWith('169.254.') && h !== '127.0.0.1') {
        // 169.254.x is link-local; only allow if somehow loopback — never 169.254.169.254
        return { ok: false, reason: 'link_local' };
      }
      return { ok: true };
    }
    return { ok: false, reason: 'metadata_or_loopback' };
  }

  if (opts.mode === 'internet') {
    if (isBlockedSsrfHost(h, 'strict')) {
      return { ok: false, reason: 'private_or_local' };
    }
    return { ok: true };
  }

  // intranet: allow private; also allow public (host can reach both)
  // still block .local mDNS? allow — useful on LAN
  return { ok: true };
}

/**
 * Full assert: parse URL, port, hostname policy, then DNS + every A/AAAA.
 */
export async function assertHostBrowseTarget(
  raw: string,
  opts: HostBrowseSsrfOpts,
): Promise<URL> {
  const field = opts.field ?? 'url';
  const u = parseBrowseUrl(raw, field);

  if (!portAllowed(u, opts)) {
    throwSsrf('Port not allowed for host browse', {
      field,
      reason: 'port',
      port: u.port || (u.protocol === 'https:' ? '443' : '80'),
      mode: opts.mode,
    });
  }

  const hostCheck = isHostAllowedForMode(u.hostname, opts);
  if (!hostCheck.ok) {
    throwSsrf('Target blocked by host-browse policy', {
      field,
      reason: hostCheck.reason ?? 'ssrf',
      host: u.hostname,
      mode: opts.mode,
    });
  }

  // Literal IP — already covered by hostname check
  const fam = isIP(u.hostname.replace(/^\[|\]$/g, ''));
  if (fam === 4 || fam === 6) {
    return u;
  }

  // DNS resolve all addresses and check each
  let addrs: string[] = [];
  try {
    const records = await dns.lookup(u.hostname, { all: true, verbatim: true });
    addrs = records.map((r) => r.address);
  } catch {
    throwSsrf('DNS resolution failed', {
      field,
      reason: 'dns_failed',
      host: u.hostname,
    });
  }
  if (!addrs.length) {
    throwSsrf('DNS returned no addresses', {
      field,
      reason: 'dns_empty',
      host: u.hostname,
    });
  }
  for (const ip of addrs) {
    const ipCheck = isHostAllowedForMode(ip, opts);
    if (!ipCheck.ok) {
      throwSsrf('Resolved address blocked by host-browse policy', {
        field,
        reason: ipCheck.reason ?? 'dns_rebinding',
        host: u.hostname,
        ip,
        mode: opts.mode,
      });
    }
  }

  // Internet mode: reject if any resolved IP is private (extra safety)
  if (opts.mode === 'internet') {
    for (const ip of addrs) {
      if (isRfc1918Host(ip) || isMetadataOrLoopbackHost(ip)) {
        throwSsrf('Resolved private/metadata address in internet mode', {
          field,
          reason: 'dns_private',
          host: u.hostname,
          ip,
        });
      }
    }
  }

  return u;
}
