/**
 * Server-side capability enforcement helpers.
 */

import {
  ErrorCodes,
  YskError,
  computeEffectiveCapabilities,
  hasCapability,
  tl,
  type CapabilityId,
  type RolePolicy,
  type SystemRole,
} from '@yanshekki/shared';

export interface CapabilityActor {
  id?: string;
  username?: string;
  roles: SystemRole[];
  capabilityGrants?: CapabilityId[] | string[];
  capabilityRevokes?: CapabilityId[] | string[];
}

export function effectiveCapsFor(
  actor: CapabilityActor,
  rolePolicies?: Partial<Record<SystemRole, RolePolicy | null | undefined>>,
): CapabilityId[] {
  return computeEffectiveCapabilities({
    roles: actor.roles,
    rolePolicies,
    grants: actor.capabilityGrants,
    revokes: actor.capabilityRevokes,
  });
}

export function actorCan(
  actor: CapabilityActor,
  cap: CapabilityId,
  rolePolicies?: Partial<Record<SystemRole, RolePolicy | null | undefined>>,
): boolean {
  return hasCapability(effectiveCapsFor(actor, rolePolicies), cap);
}

/**
 * Throw 403 if actor lacks capability.
 */
export function requireCapability(
  actor: CapabilityActor,
  cap: CapabilityId,
  rolePolicies?: Partial<Record<SystemRole, RolePolicy | null | undefined>>,
): void {
  if (!actorCan(actor, cap, rolePolicies)) {
    throw new YskError(ErrorCodes.FORBIDDEN, tl('notes.needAdmin'), {
      httpStatus: 403,
      details: { capability: cap },
      messageKey: 'errors.rbac.missingCapability',
      messageParams: { capability: cap },
    });
  }
}
