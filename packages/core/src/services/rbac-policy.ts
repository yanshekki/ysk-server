/**
 * Role policy store: factory defaults, custom policies, one-click restore.
 * Per-user grants/revokes live on StoreUser; this service owns role-level policy.
 */

import {
  ErrorCodes,
  YskError,
  computeEffectiveCapabilities,
  factoryRolePolicy,
  factoryRolePolicies,
  hasCapability,
  isCapabilityId,
  normalizeRolePolicy,
  resolveRolePolicy,
  SYSTEM_ROLES,
  tl,
  type CapabilityId,
  type OperationLevel,
  type RolePolicy,
  type SystemRole,
} from 'ysk-server-shared';
import type { YskDatabase } from '../db/database.js';
import type { StoreUser } from '../db/store.js';
import type { AuditRepository } from '../repositories/audit-repo.js';

export type StoredRolePolicy = RolePolicy & {
  updated_at?: string;
  updated_by?: string;
};

export interface RolePolicyView {
  role: SystemRole;
  policy: RolePolicy;
  dirty: boolean;
  factory: RolePolicy;
}

export class RbacPolicyService {
  constructor(
    private readonly db: YskDatabase,
    private readonly audit?: AuditRepository,
  ) {}

  /** All role policies currently in effect (+ dirty flags) */
  listPolicies(): RolePolicyView[] {
    return SYSTEM_ROLES.map((role) => {
      const factory = factoryRolePolicy(role);
      const stored = this.getStored(role);
      const { policy, dirty } = resolveRolePolicy(role, stored);
      return {
        role,
        policy,
        dirty,
        factory,
      };
    });
  }

  getEffectivePolicy(role: SystemRole): RolePolicy {
    const stored = this.getStored(role);
    return resolveRolePolicy(role, stored).policy;
  }

  /** Map for computeEffectiveCapabilities — only dirty customs override factory */
  rolePolicyMap(): Partial<Record<SystemRole, RolePolicy>> {
    const out: Partial<Record<SystemRole, RolePolicy>> = {};
    for (const role of SYSTEM_ROLES) {
      const stored = this.getStored(role);
      const { policy, dirty } = resolveRolePolicy(role, stored);
      if (dirty) out[role] = policy;
    }
    return out;
  }

  effectiveForUser(user: Pick<StoreUser, 'roles' | 'capability_grants' | 'capability_revokes'>): CapabilityId[] {
    return computeEffectiveCapabilities({
      roles: user.roles,
      rolePolicies: this.rolePolicyMap(),
      grants: user.capability_grants,
      revokes: user.capability_revokes,
    });
  }

  actorCan(
    user: Pick<StoreUser, 'roles' | 'capability_grants' | 'capability_revokes'>,
    cap: CapabilityId,
  ): boolean {
    return hasCapability(this.effectiveForUser(user), cap);
  }

  requireCapability(
    user: Pick<StoreUser, 'roles' | 'capability_grants' | 'capability_revokes'>,
    cap: CapabilityId,
  ): void {
    if (!this.actorCan(user, cap)) {
      throw new YskError(ErrorCodes.FORBIDDEN, tl('notes.needAdmin'), {
        httpStatus: 403,
        details: { capability: cap },
      });
    }
  }

  /**
   * Ensure at least one non-suspended user has full admin factory caps.
   * Call on boot and after policy mutations. Safe no-op when already healthy.
   */
  ensureFullPrivilegeHolder(): {
    ok: boolean;
    repaired: boolean;
    username?: string;
  } {
    const holders = this.db.snapshot.users.filter(
      (u) => !u.suspended && this.actorCan(u, 'users.manage') && this.actorCan(u, 'rbac.policy'),
    );
    if (holders.length > 0) {
      return { ok: true, repaired: false, username: holders[0]?.username };
    }

    // Repair: clear restrictive admin role policy + pick an admin user (or first user)
    if (this.db.snapshot.rbac_policies?.admin) {
      delete this.db.snapshot.rbac_policies.admin;
    }
    let target =
      this.db.snapshot.users.find((u) => !u.suspended && u.roles.includes('admin')) ??
      this.db.snapshot.users.find((u) => !u.suspended) ??
      this.db.snapshot.users[0];
    if (!target) {
      return { ok: false, repaired: false };
    }
    if (!target.roles.includes('admin')) {
      target.roles = ['admin', ...target.roles.filter((r) => r !== 'admin')];
    }
    // Clear revokes that could strip privilege (admin ignore revokes anyway)
    delete target.capability_revokes;
    // Ensure no empty grants weirdness
    target.updated_at = new Date().toISOString();
    this.db.persist();
    this.audit?.append({
      actor: 'system',
      action: 'rbac.ensure_full_privilege',
      resource: target.username,
      detail: { userId: target.id, repaired: true },
      ok: true,
    });
    return { ok: true, repaired: true, username: target.username };
  }

  setRolePolicy(
    role: SystemRole,
    input: { maxLevel?: OperationLevel; capabilities?: string[] },
    actor: { id: string; username: string; roles: SystemRole[]; capability_grants?: CapabilityId[]; capability_revokes?: CapabilityId[] },
  ): RolePolicyView {
    this.requireCapability(actor as StoreUser, 'rbac.policy');
    if (!SYSTEM_ROLES.includes(role)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1027'), { httpStatus: 400 });
    }

    // Admin system role is always full-open — refuse reductions; only restore/full factory allowed
    if (role === 'admin') {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0500'), {
        httpStatus: 400,
        details: {
          reason: 'admin_role_always_full',
          message: 'Admin role is locked to full factory capabilities; use restore or edit other roles.',
        },
      });
    }

    const next = normalizeRolePolicy(input);

    const previewMap = { ...this.rolePolicyMap(), [role]: next };
    this.assertNotLastPrivilegeLockout(actor, previewMap, null);

    if (!this.db.snapshot.rbac_policies) this.db.snapshot.rbac_policies = {};
    this.db.snapshot.rbac_policies[role] = {
      ...next,
      updated_at: new Date().toISOString(),
      updated_by: actor.username,
    };
    this.db.persist();
    this.audit?.append({
      actor: actor.username,
      action: 'rbac.policy.update',
      resource: role,
      detail: { maxLevel: next.maxLevel, capabilities: next.capabilities },
      ok: true,
    });
    return this.listPolicies().find((p) => p.role === role)!;
  }

  restoreRole(
    role: SystemRole,
    actor: { id: string; username: string; roles: SystemRole[]; capability_grants?: CapabilityId[]; capability_revokes?: CapabilityId[] },
  ): RolePolicyView {
    this.requireCapability(actor as StoreUser, 'rbac.policy');
    if (!SYSTEM_ROLES.includes(role)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1027'), { httpStatus: 400 });
    }
    const previewMap = { ...this.rolePolicyMap() };
    delete previewMap[role];
    this.assertNotLastPrivilegeLockout(actor, previewMap, null);

    if (this.db.snapshot.rbac_policies?.[role]) {
      delete this.db.snapshot.rbac_policies[role];
      this.db.persist();
    }
    this.audit?.append({
      actor: actor.username,
      action: 'rbac.policy.restore',
      resource: role,
      detail: {},
      ok: true,
    });
    return this.listPolicies().find((p) => p.role === role)!;
  }

  restoreAllRoles(actor: {
    id: string;
    username: string;
    roles: SystemRole[];
    capability_grants?: CapabilityId[];
    capability_revokes?: CapabilityId[];
  }): RolePolicyView[] {
    this.requireCapability(actor as StoreUser, 'rbac.policy');
    this.assertNotLastPrivilegeLockout(actor, {}, null);
    this.db.snapshot.rbac_policies = {};
    this.db.persist();
    this.audit?.append({
      actor: actor.username,
      action: 'rbac.policy.restore_all',
      detail: {},
      ok: true,
    });
    return this.listPolicies();
  }

  /**
   * Set per-user capability overrides. Caller must have users.manage.
   */
  setUserOverrides(
    userId: string,
    patch: { grants?: string[] | null; revokes?: string[] | null },
    actor: { id: string; username: string; roles: SystemRole[]; capability_grants?: CapabilityId[]; capability_revokes?: CapabilityId[] },
  ): StoreUser {
    this.requireCapability(actor as StoreUser, 'users.manage');
    const u = this.db.snapshot.users.find((x) => x.id === userId);
    if (!u) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.n0002'), { httpStatus: 404 });
    }

    // Never apply revokes to admin-role users — they stay full-open
    if (u.roles.includes('admin') && patch.revokes !== undefined && patch.revokes !== null) {
      const rev = (patch.revokes as string[]).filter(Boolean);
      if (rev.length > 0) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0500'), {
          httpStatus: 400,
          details: { reason: 'admin_user_no_revokes' },
        });
      }
    }

    const grants =
      patch.grants === null
        ? []
        : patch.grants !== undefined
          ? patch.grants.filter((id): id is CapabilityId => isCapabilityId(id))
          : (u.capability_grants ?? []);
    const revokes =
      u.roles.includes('admin')
        ? []
        : patch.revokes === null
          ? []
          : patch.revokes !== undefined
            ? patch.revokes.filter((id): id is CapabilityId => isCapabilityId(id))
            : (u.capability_revokes ?? []);

    this.assertNotLastPrivilegeLockout(actor, this.rolePolicyMap(), { userId, grants, revokes });

    u.capability_grants = grants.length ? grants : undefined;
    u.capability_revokes = revokes.length ? revokes : undefined;
    if (!u.capability_grants) delete u.capability_grants;
    if (!u.capability_revokes) delete u.capability_revokes;
    u.updated_at = new Date().toISOString();
    this.db.persist();
    this.audit?.append({
      actor: actor.username,
      action: 'rbac.user_overrides.update',
      resource: userId,
      detail: { grants, revokes },
      ok: true,
    });
    return { ...u };
  }

  restoreUserOverrides(
    userId: string,
    actor: { id: string; username: string; roles: SystemRole[]; capability_grants?: CapabilityId[]; capability_revokes?: CapabilityId[] },
  ): StoreUser {
    return this.setUserOverrides(userId, { grants: null, revokes: null }, actor);
  }

  defaults() {
    return {
      version: factoryRolePolicy('admin').defaultsVersion,
      roles: factoryRolePolicies(),
    };
  }

  private getStored(role: SystemRole): StoredRolePolicy | undefined {
    const raw = this.db.snapshot.rbac_policies?.[role];
    if (!raw) return undefined;
    return normalizeRolePolicy(raw) as StoredRolePolicy;
  }

  /**
   * After a hypothetical change, at least one non-suspended user must still
   * effectively hold users.manage AND rbac.policy.
   */
  private assertNotLastPrivilegeLockout(
    _actor: { id: string; roles: SystemRole[]; capability_grants?: CapabilityId[]; capability_revokes?: CapabilityId[] },
    rolePolicies: Partial<Record<SystemRole, RolePolicy>>,
    userOverride: { userId: string; grants: CapabilityId[]; revokes: CapabilityId[] } | null,
  ): void {
    const holders = this.db.snapshot.users.filter((u) => {
      if (u.suspended) return false;
      const grants =
        userOverride && userOverride.userId === u.id
          ? userOverride.grants
          : u.capability_grants;
      const revokes =
        userOverride && userOverride.userId === u.id
          ? userOverride.revokes
          : u.capability_revokes;
      const caps = computeEffectiveCapabilities({
        roles: u.roles,
        rolePolicies,
        grants,
        revokes,
      });
      return hasCapability(caps, 'users.manage') && hasCapability(caps, 'rbac.policy');
    });
    if (holders.length === 0) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0500'), {
        httpStatus: 400,
        details: { reason: 'last_privilege_holder' },
      });
    }
  }
}
