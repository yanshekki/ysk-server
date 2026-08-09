/**
 * Outbound header allowlist — never forward operator browser identity.
 */

import {
  HOST_BROWSE_ACCEPT,
  HOST_BROWSE_ACCEPT_LANGUAGE,
  HOST_BROWSE_DEFAULT_UA,
} from './types.js';

/** Headers that must never leave the control plane toward a browse target. */
const FORBIDDEN_PREFIXES = [
  'sec-ch-',
  'sec-fetch-',
  'x-forwarded-',
  'x-real-',
  'x-ysk-',
  'proxy-',
];

const FORBIDDEN_EXACT = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'forwarded',
  'true-client-ip',
  'cf-connecting-ip',
  'x-api-key',
  'origin',
  'referer',
  'user-agent',
  'x-request-id',
  'traceparent',
  'tracestate',
]);

export function isForbiddenOutboundHeader(name: string): boolean {
  const n = name.toLowerCase();
  if (FORBIDDEN_EXACT.has(n)) return true;
  return FORBIDDEN_PREFIXES.some((p) => n.startsWith(p));
}

/**
 * Build clean egress headers. Only server-controlled values + optional jar cookie / body type.
 */
export function buildOutboundHeaders(opts: {
  userAgent?: string;
  acceptLanguage?: string;
  cookie?: string;
  contentType?: string;
  referer?: string | null;
  extraSafe?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': opts.userAgent ?? HOST_BROWSE_DEFAULT_UA,
    Accept: HOST_BROWSE_ACCEPT,
    'Accept-Language': opts.acceptLanguage ?? HOST_BROWSE_ACCEPT_LANGUAGE,
    'Accept-Encoding': 'gzip, deflate, br',
    // Do not send panel Origin; omit client hints entirely
  };
  if (opts.cookie) {
    headers.Cookie = opts.cookie;
  }
  if (opts.contentType) {
    headers['Content-Type'] = opts.contentType;
  }
  // Referer only if same-session previous target URL (never panel origin)
  if (opts.referer && /^https?:\/\//i.test(opts.referer)) {
    headers.Referer = opts.referer;
  }
  if (opts.extraSafe) {
    for (const [k, v] of Object.entries(opts.extraSafe)) {
      if (!isForbiddenOutboundHeader(k) && v) {
        headers[k] = v;
      }
    }
  }
  return headers;
}

/** Response headers safe to expose to the panel (not Set-Cookie values). */
export function filterResponseMetaHeaders(
  headers: Headers | Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const allow = new Set([
    'content-type',
    'content-length',
    'content-language',
    'cache-control',
    'last-modified',
    'etag',
    'location',
  ]);
  const getAll = (name: string): string | null => {
    if (headers instanceof Headers) {
      return headers.get(name);
    }
    const v = headers[name] ?? headers[name.toLowerCase()];
    if (v == null) return null;
    return Array.isArray(v) ? v.join(', ') : String(v);
  };
  for (const name of allow) {
    const v = getAll(name);
    if (v) out[name] = v;
  }
  return out;
}
