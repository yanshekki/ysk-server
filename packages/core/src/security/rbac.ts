import { tl } from 'ysk-server-shared';
/**
 * Three-axis RBAC: role × resource scope × operation level.
 */

import type { OperationLevel, ResourceScope, SystemRole } from 'ysk-server-shared';

/** Privilege rank: higher can do everything lower can */
const LEVEL_RANK: Record<OperationLevel, number> = {
  read: 1,
  'write-low': 2,
  'write-high': 3,
  destructive: 4,
  privilege: 5,
};

/** Max operation level permitted per role (global default) */
const ROLE_MAX_LEVEL: Record<SystemRole, OperationLevel> = {
  admin: 'privilege',
  operator: 'write-high',
  viewer: 'read',
  agent: 'write-low',
};

export interface RbacDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Check whether a role may perform an operation at the given scope.
 * Project-scoped destructive ops still require operator+; agents are capped at write-low.
 */
export function checkRbac(
  role: SystemRole,
  scope: ResourceScope,
  level: OperationLevel,
): RbacDecision {
  const max = ROLE_MAX_LEVEL[role];
  if (!max) {
    return { allowed: false, reason: tl('notes.auto.t0016', { v0: (role) }) };
  }
  if (LEVEL_RANK[level] > LEVEL_RANK[max]) {
    return {
      allowed: false,
      reason: tl('notes.auto.t0017', { v0: (role), v1: (level), v2: (max) }),
    };
  }
  // Viewers cannot write on any scope
  if (role === 'viewer' && level !== 'read') {
    return { allowed: false, reason: tl('notes.auto.n1027') };
  }
  // Agents cannot operate at global privilege scope for high ops
  if (role === 'agent' && scope.kind === 'global' && LEVEL_RANK[level] >= LEVEL_RANK['write-high']) {
    return {
      allowed: false,
      reason: tl('notes.auto.n0075'),
    };
  }
  // Project scope requires an id for non-global
  if ((scope.kind === 'project' || scope.kind === 'server') && !scope.id && level !== 'read') {
    return {
      allowed: false,
      reason: tl('notes.auto.t0018', { v0: (scope.kind) }),
    };
  }
  return { allowed: true };
}

/**
 * True if role may at least reach the given level.
 */
export function roleCan(role: SystemRole, level: OperationLevel): boolean {
  return LEVEL_RANK[level] <= LEVEL_RANK[ROLE_MAX_LEVEL[role]];
}
