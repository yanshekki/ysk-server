/**
 * HTTP helpers for capability checks.
 */
import {
  matchGetRouteCaps,
  matchMutatingRouteCap,
  type CapabilityId,
  type UserDto,
} from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import { getBearer } from './util.js';
import type { IncomingMessage } from 'node:http';

/** Resolve store fields + require capability (throws YskError 403). */
export function requireCap(ctx: AppContext, user: UserDto, cap: CapabilityId): void {
  const row = ctx.db.snapshot.users.find((u) => u.id === user.id);
  ctx.rbac.requireCapability(
    {
      roles: user.roles,
      capability_grants: row?.capability_grants ?? user.capabilityGrants,
      capability_revokes: row?.capability_revokes ?? user.capabilityRevokes,
    },
    cap,
  );
}

/** GET surfaces that any of several read/write caps may open. */
export function requireAnyCap(
  ctx: AppContext,
  user: UserDto,
  caps: readonly CapabilityId[],
): void {
  const have = new Set(effectiveCaps(ctx, user));
  if (caps.some((c) => have.has(c))) return;
  requireCap(ctx, user, caps[0]!);
}

export function effectiveCaps(ctx: AppContext, user: UserDto): string[] {
  const row = ctx.db.snapshot.users.find((u) => u.id === user.id);
  return ctx.rbac.effectiveForUser({
    roles: user.roles,
    capability_grants: row?.capability_grants ?? user.capabilityGrants,
    capability_revokes: row?.capability_revokes ?? user.capabilityRevokes,
  });
}

/**
 * Paths that skip central capability gate:
 * - public auth (login / webauthn)
 * - self-service auth mutations (session already authenticated in handler, or public)
 * - agent fleet register (device bootstrap; agent token checked in handler if any)
 * - webmail SSO consume
 */
const PUBLIC_MUTATING_PREFIXES = [
  '/api/v1/email/webmail/sso/consume',
  '/api/v1/auth/login',
  '/api/v1/auth/logout',
  '/api/v1/auth/locale',
  '/api/v1/auth/password', // self-service change (still needs session in handler)
  '/api/v1/auth/totp',
  '/api/v1/auth/sessions',
  '/api/v1/auth/devices',
  '/api/v1/auth/webauthn',
  '/api/v1/auth/api-keys', // handler still checks; self-service keys
  // Fleet/agent register is NOT public — requires panel auth or enroll token in handler
];

/**
 * Edge agent poller paths — agent secret checked in handler (not panel session).
 * Register is intentionally excluded (enrollment / panel auth required).
 */
function isFleetAgentPublicMutating(pathname: string): boolean {
  return (
    /^\/api\/v1\/fleet\/agents\/[^/]+\/heartbeat$/.test(pathname) ||
    /^\/api\/v1\/fleet\/commands\/[^/]+\/ack$/.test(pathname)
  );
}

/**
 * Central gate for mutating /api/v1 routes listed in MUTATING_ROUTE_CAP_RULES.
 * Call early in the HTTP pipeline; throws YskError on deny.
 * No-op when method is not mutating or path has no rule.
 */
export function enforceMutatingRouteCaps(
  ctx: AppContext,
  req: IncomingMessage,
  method: string,
  pathname: string,
): void {
  if (!pathname.startsWith('/api/v1/')) return;
  const m = method.toUpperCase();
  if (m !== 'POST' && m !== 'PUT' && m !== 'PATCH' && m !== 'DELETE') return;
  if (PUBLIC_MUTATING_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return;
  }
  if (isFleetAgentPublicMutating(pathname)) {
    return;
  }
  const cap = matchMutatingRouteCap(m, pathname);
  if (!cap) return;
  const user = ctx.auth.authenticate(getBearer(req));
  requireCap(ctx, user, cap);
}

const GET_CAP_SKIP = [
  '/api/v1/auth',
  '/api/v1/public',
  '/api/v1/nav',
];

function skipGetRouteCaps(pathname: string): boolean {
  if (
    pathname === '/api/v1/health' ||
    pathname === '/api/v1/status' ||
    pathname === '/api/v1/readiness' ||
    pathname === '/api/v1/notifications' ||
    pathname === '/api/v1/search'
  ) {
    return true;
  }
  if (GET_CAP_SKIP.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }
  if (pathname.startsWith('/api/v1/vnc/share/')) return true;
  // Agent poller pull (history=1 still gated in the handler)
  if (/^\/api\/v1\/fleet\/agents\/[^/]+\/commands$/.test(pathname)) return true;
  return false;
}

/**
 * Central GET inventory gate (any-of caps). No-op when no rule or skipped.
 */
export function enforceGetRouteCaps(
  ctx: AppContext,
  req: IncomingMessage,
  method: string,
  pathname: string,
): void {
  if ((method ?? 'GET').toUpperCase() !== 'GET') return;
  if (!pathname.startsWith('/api/v1/')) return;
  if (skipGetRouteCaps(pathname)) return;
  const caps = matchGetRouteCaps(pathname);
  if (!caps?.length) return;
  const user = ctx.auth.authenticate(getBearer(req));
  requireAnyCap(ctx, user, caps);
}
