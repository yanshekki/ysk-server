/**
 * Thin auth helpers for route modules — secondary features should use these.
 */
import type { IncomingMessage } from 'node:http';
import type { CapabilityId, UserDto } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import { requireCap } from './rbac-guard.js';
import { getBearer } from './util.js';

/** Authenticate bearer → UserDto (throws YskError 401). */
export function requireUser(ctx: AppContext, req: IncomingMessage): UserDto {
  return ctx.auth.authenticate(getBearer(req));
}

/** Authenticate + require capability. */
export function requireUserCap(
  ctx: AppContext,
  req: IncomingMessage,
  cap: CapabilityId,
): UserDto {
  const user = requireUser(ctx, req);
  requireCap(ctx, user, cap);
  return user;
}
