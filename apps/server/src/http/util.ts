/**
 * Shared HTTP helpers for control-plane handlers.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  YskError,
  ErrorCodes,
  localizeOpsResult,
  resolveRequestLocale,
  tl,
  type LocaleCode,
  type OpsResultInput,
} from 'ysk-server-shared';

export const DEFAULT_JSON_BODY_LIMIT = 1_048_576;
export const LOGIN_BODY_LIMIT = 262_144;

function payloadTooLarge(): YskError {
  return new YskError(ErrorCodes.VALIDATION, tl('errors.http.payloadTooLarge'), {
    httpStatus: 413,
    details: { reason: 'payload_too_large' },
  });
}

export function readBody(
  req: IncomingMessage,
  opts?: { maxBytes?: number },
): Promise<string> {
  const max = opts?.maxBytes ?? DEFAULT_JSON_BODY_LIMIT;
  return new Promise((resolve, reject) => {
    const cl = Number(req.headers?.['content-length']);
    if (Number.isFinite(cl) && cl > max) {
      reject(payloadTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let n = 0;
    let rejected = false;
    req.on('data', (c) => {
      if (rejected) return;
      const b = Buffer.from(c);
      n += b.length;
      if (n > max) {
        rejected = true;
        req.destroy();
        reject(payloadTooLarge());
        return;
      }
      chunks.push(b);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/** Baseline security headers for all JSON API responses. */
export function securityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  };
  // CORS: same-origin panel needs no *; set YSK_CORS_ORIGIN for split-origin dev only
  const cors = process.env.YSK_CORS_ORIGIN?.trim();
  if (cors && cors !== '*') {
    headers['Access-Control-Allow-Origin'] = cors;
    headers['Access-Control-Allow-Headers'] =
      'Content-Type, Authorization, Accept-Language, X-Share-Password, X-Ysk-Agent-Token';
    headers['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,PUT,DELETE,OPTIONS';
    headers.Vary = 'Origin';
  }
  if (process.env.YSK_HSTS === '1' || process.env.YSK_HSTS === 'true') {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...securityHeaders(),
  });
  res.end(payload);
}

/**
 * Honest HTTP status from ops result.
 * - ok true → 200 (includes written-only control-plane success)
 * - blocked / apply_status blocked → 403
 * - failed apply missing EXECUTE (ok false + requires*) → 403
 * - other ok false → 422
 * - notFound option → 404 when !ok
 */
export function statusFromOpsResult(
  result: {
    ok?: boolean;
    blocked?: boolean;
    requiresExecute?: boolean;
    requiresRoot?: boolean;
    dryRun?: boolean;
    apply_status?: string;
  },
  opts?: { notFound?: boolean },
): number {
  if (result.ok === true) return 200;
  if (opts?.notFound) return 404;
  if (
    result.blocked === true ||
    result.apply_status === 'blocked' ||
    result.requiresExecute === true ||
    result.requiresRoot === true
  ) {
    return 403;
  }
  return 422;
}

export type SendOpsOptions = {
  /** When result is not ok, use 404 instead of 403/422 */
  notFound?: boolean;
};

/**
 * Normalize honesty, localize notes/blockMessage, then send JSON with correct status.
 */
export function sendOpsResult(
  res: ServerResponse,
  result: object,
  opts?: SendOpsOptions,
): void {
  const raw = result as OpsResultInput & Record<string, unknown>;
  const notes = Array.isArray(raw.notes) ? raw.notes.map(String) : [];
  const honest = localizeOpsResult({
    ok: raw.ok,
    apply_status: raw.apply_status as OpsResultInput['apply_status'],
    blocked: raw.blocked,
    blockMessage: raw.blockMessage,
    requiresExecute: raw.requiresExecute,
    requiresRoot: raw.requiresRoot,
    notes,
    written: Array.isArray(raw.written) ? raw.written.map(String) : undefined,
  });
  const body = { ...raw, ...honest };
  sendJson(res, statusFromOpsResult(honest, opts), body);
}

/**
 * Heuristic: body looks like an ops result (has ok + notes/blocked/apply_status).
 */
export function looksLikeOpsResult(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const o = body as Record<string, unknown>;
  if (typeof o.ok !== 'boolean') return false;
  if (Array.isArray(o.notes)) return true;
  if (typeof o.blocked === 'boolean') return true;
  if (typeof o.apply_status === 'string') return true;
  if (typeof o.requiresExecute === 'boolean' || typeof o.requiresRoot === 'boolean') {
    return true;
  }
  return false;
}

export function getBearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return undefined;
  return h.slice('Bearer '.length).trim();
}

export function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
}

/** Locale from Accept-Language (and optional query). */
export function localeFromRequest(req: IncomingMessage, url?: URL): LocaleCode {
  return resolveRequestLocale({
    acceptLanguage: req.headers['accept-language'],
    queryLocale: url?.searchParams.get('locale'),
  });
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof YskError) {
    sendJson(res, err.httpStatus, {
      ok: false,
      code: err.code,
      message: err.localize(),
      details: err.details,
      ...(typeof err.details === 'object' && err.details
        ? (err.details as object)
        : {}),
    });
    return;
  }
  const message = err instanceof Error ? err.message : tl('errors.http.internal');
  sendJson(res, 500, { ok: false, code: 'YSK_INTERNAL', message });
}
