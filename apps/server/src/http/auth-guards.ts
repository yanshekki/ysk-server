/**
 * HTTP auth hardening: must-change-password + API-key read-only + agent token helper.
 */
import type { IncomingMessage } from 'node:http';
import { ErrorCodes, yskError } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { getBearer } from './util.js';

/** Paths allowed while must_change_password is set. */
const MUST_CHANGE_ALLOW = [
  '/api/v1/auth/login',
  '/api/v1/auth/logout',
  '/api/v1/auth/me',
  '/api/v1/auth/password',
  '/api/v1/auth/locale',
  '/health',
  '/api/v1/health',
];

function isMustChangeAllowed(pathname: string): boolean {
  return MUST_CHANGE_ALLOW.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Block APIs when authenticated user must change password.
 */
export function enforceMustChangePassword(
  ctx: AppContext,
  req: IncomingMessage,
  _method: string,
  pathname: string,
): void {
  if (!pathname.startsWith('/api/v1/')) return;
  if (isMustChangeAllowed(pathname)) return;
  const token = getBearer(req);
  if (!token) return;
  try {
    const user = ctx.auth.authenticate(token);
    if (user.mustChangePassword) {
      throw yskError(ErrorCodes.FORBIDDEN, {
        httpStatus: 403,
        messageKey: 'errors.auth.mustChangePassword',
        details: { mustChangePassword: true },
      });
    }
  } catch (e) {
    if (
      e &&
      typeof e === 'object' &&
      'httpStatus' in e &&
      (e as { httpStatus?: number }).httpStatus === 403 &&
      'details' in e &&
      (e as { details?: { mustChangePassword?: boolean } }).details?.mustChangePassword
    ) {
      throw e;
    }
    // ignore other auth errors — route handlers authenticate again
  }
}

/**
 * Block mutating methods for read-only API keys (`scope: read`).
 */
export function enforceApiKeyReadOnly(
  ctx: AppContext,
  req: IncomingMessage,
  method: string,
  pathname: string,
): void {
  if (!pathname.startsWith('/api/v1/')) return;
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return;
  if (pathname === '/api/v1/auth/login' || pathname.startsWith('/api/v1/auth/login/')) return;
  const token = getBearer(req);
  if (!token || !token.startsWith('ysk_') || token.startsWith('ysk_agent_')) return;
  try {
    const det = ctx.auth.authenticateDetailed(token);
    if (det.apiKeyReadOnly) {
      throw yskError(ErrorCodes.FORBIDDEN, {
        httpStatus: 403,
        messageKey: 'errors.auth.apiKeyReadOnly',
        details: { scope: 'read', method: m, path: pathname },
      });
    }
  } catch (e) {
    if (
      e &&
      typeof e === 'object' &&
      'details' in e &&
      (e as { details?: { scope?: string } }).details?.scope === 'read'
    ) {
      throw e;
    }
  }
}

/**
 * Agent secret from `X-Ysk-Agent-Token` or `Authorization: Bearer ysk_agent_…`.
 */
export function getAgentToken(req: IncomingMessage): string | undefined {
  const h = req.headers['x-ysk-agent-token'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  if (Array.isArray(h) && h[0]?.trim()) return h[0].trim();
  const bearer = getBearer(req);
  if (bearer?.startsWith('ysk_agent_')) return bearer;
  return undefined;
}
