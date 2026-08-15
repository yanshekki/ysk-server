import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CATALOG,
  CRITICAL_PRIVILEGE_CAPS,
  applyBandToCapabilities,
  capabilitiesInBand,
  capabilitiesUpToLevel,
  compareLevels,
  computeEffectiveCapabilities,
  factoryRolePolicies,
  factoryRolePolicy,
  getCapabilityDef,
  hasCapability,
  hasCriticalPrivilege,
  isCapabilityId,
  isFactoryPolicy,
  levelRank,
  normalizeRolePolicy,
  resolveRolePolicy,
} from './capabilities.js';

describe('capability catalog + factory', () => {
  it('factory admin has privilege caps; operator does not', () => {
    const admin = factoryRolePolicy('admin');
    const op = factoryRolePolicy('operator');
    expect(hasCapability(admin.capabilities, 'users.manage')).toBe(true);
    expect(hasCapability(admin.capabilities, 'rbac.policy')).toBe(true);
    expect(hasCapability(admin.capabilities, 'backups.restore')).toBe(true);
    expect(hasCapability(op.capabilities, 'users.manage')).toBe(false);
    expect(hasCapability(op.capabilities, 'backups.restore')).toBe(false);
    expect(hasCapability(op.capabilities, 'updates.apply')).toBe(true);
    expect(hasCapability(op.capabilities, 'projects.write')).toBe(true);
    expect(hasCapability(op.capabilities, 'validators.manage')).toBe(true);
    expect(hasCapability(op.capabilities, 'validators.wipe')).toBe(false);
    expect(hasCapability(admin.capabilities, 'validators.wipe')).toBe(true);
    expect(hasCapability(op.capabilities, 'docker.manage')).toBe(true);
    expect(hasCapability(op.capabilities, 'docker.wipe')).toBe(false);
    expect(hasCapability(admin.capabilities, 'docker.wipe')).toBe(true);
  });

  it('viewer is read-only', () => {
    const v = factoryRolePolicy('viewer');
    expect(v.maxLevel).toBe('read');
    expect(hasCapability(v.capabilities, 'dashboard.read')).toBe(true);
    expect(hasCapability(v.capabilities, 'validators.read')).toBe(true);
    expect(hasCapability(v.capabilities, 'docker.read')).toBe(true);
    expect(hasCapability(v.capabilities, 'projects.write')).toBe(false);
    expect(hasCapability(v.capabilities, 'validators.manage')).toBe(false);
  });

  it('effective unions roles, applies grants and revokes', () => {
    const base = computeEffectiveCapabilities({ roles: ['operator'] });
    expect(hasCapability(base, 'updates.apply')).toBe(true);

    const granted = computeEffectiveCapabilities({
      roles: ['operator'],
      grants: ['backups.restore'],
    });
    expect(hasCapability(granted, 'backups.restore')).toBe(true);

    // Admin revokes are ignored — always full open
    const revoked = computeEffectiveCapabilities({
      roles: ['admin'],
      revokes: ['users.impersonate'],
    });
    expect(hasCapability(revoked, 'users.impersonate')).toBe(true);
    expect(hasCapability(revoked, 'users.manage')).toBe(true);
  });

  it('admin ignores dirty reduced role policy', () => {
    const caps = computeEffectiveCapabilities({
      roles: ['admin'],
      rolePolicies: {
        admin: { maxLevel: 'read', capabilities: ['dashboard.read'] },
      },
      revokes: ['users.manage'],
    });
    expect(hasCapability(caps, 'users.manage')).toBe(true);
    expect(hasCapability(caps, 'rbac.policy')).toBe(true);
    expect(hasCapability(caps, 'backups.restore')).toBe(true);
  });

  it('custom role policy overrides factory', () => {
    const caps = computeEffectiveCapabilities({
      roles: ['operator'],
      rolePolicies: {
        operator: {
          maxLevel: 'destructive',
          capabilities: ['dashboard.read', 'backups.restore'],
        },
      },
    });
    expect(hasCapability(caps, 'backups.restore')).toBe(true);
    expect(hasCapability(caps, 'updates.apply')).toBe(false);
  });

  it('normalizeRolePolicy drops caps above maxLevel', () => {
    const p = normalizeRolePolicy({
      maxLevel: 'write-low',
      capabilities: ['projects.write', 'updates.apply', 'users.manage', 'not.real'],
    });
    expect(p.capabilities).toEqual(['projects.write']);
  });

  it('isFactoryPolicy detects dirty operator', () => {
    expect(isFactoryPolicy('operator', factoryRolePolicy('operator'))).toBe(true);
    const dirty = normalizeRolePolicy({
      maxLevel: 'destructive',
      capabilities: [...factoryRolePolicy('operator').capabilities, 'backups.restore'],
    });
    expect(isFactoryPolicy('operator', dirty)).toBe(false);
  });

  it('applyBandToCapabilities toggles a whole band', () => {
    let caps = factoryRolePolicy('operator').capabilities;
    caps = applyBandToCapabilities(caps, 'destructive', true, 'destructive');
    expect(hasCapability(caps, 'backups.restore')).toBe(true);
    caps = applyBandToCapabilities(caps, 'destructive', false, 'destructive');
    expect(hasCapability(caps, 'backups.restore')).toBe(false);
  });

  it('catalog ids are unique', () => {
    const ids = CAPABILITY_CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolveRolePolicy upgrades pure factory subsets (defaultsVersion bump)', () => {
    const factory = factoryRolePolicy('operator');
    const subset = {
      maxLevel: factory.maxLevel,
      capabilities: factory.capabilities.filter((c) => c !== 'backups.run'),
      defaultsVersion: 0,
    };
    const r = resolveRolePolicy('operator', subset);
    expect(r.dirty).toBe(false);
    expect(hasCapability(r.policy.capabilities, 'backups.run')).toBe(true);
  });

  it('resolveRolePolicy keeps intentional extras as dirty', () => {
    const factory = factoryRolePolicy('operator');
    const custom = {
      maxLevel: 'destructive' as const,
      capabilities: [...factory.capabilities, 'backups.restore' as const],
    };
    const r = resolveRolePolicy('operator', custom);
    expect(r.dirty).toBe(true);
    expect(hasCapability(r.policy.capabilities, 'backups.restore')).toBe(true);
  });
});

describe('capability helpers + resolve edge paths', () => {
  it('isCapabilityId / getCapabilityDef / band + level helpers', () => {
    expect(isCapabilityId('dashboard.read')).toBe(true);
    expect(isCapabilityId('not.a.cap')).toBe(false);
    expect(getCapabilityDef('dashboard.read')?.band).toBe('read');
    expect(getCapabilityDef('users.manage')?.labelKey).toMatch(/rbac\.cap/);
    expect(capabilitiesInBand('privilege')).toContain('users.manage');
    expect(capabilitiesInBand('read').every((id) => getCapabilityDef(id)?.band === 'read')).toBe(
      true,
    );
    expect(capabilitiesUpToLevel('write-low')).toContain('projects.write');
    expect(capabilitiesUpToLevel('write-low')).not.toContain('updates.apply');
    expect(levelRank('read')).toBeLessThan(levelRank('privilege'));
    expect(compareLevels('write-low', 'write-high')).toBeLessThan(0);
    expect(compareLevels('destructive', 'destructive')).toBe(0);
  });

  it('factoryRolePolicies returns all system roles', () => {
    const all = factoryRolePolicies();
    expect(all.admin.maxLevel).toBe('privilege');
    expect(all.operator.maxLevel).toBe('write-high');
    expect(all.viewer.maxLevel).toBe('read');
    expect(all.agent.maxLevel).toBe('write-low');
    expect(all.admin.capabilities.length).toBeGreaterThan(all.viewer.capabilities.length);
  });

  it('normalizeRolePolicy defaults invalid maxLevel and empty caps', () => {
    const p = normalizeRolePolicy({});
    expect(p.maxLevel).toBe('read');
    expect(p.capabilities).toEqual([]);
    const bad = normalizeRolePolicy({
      maxLevel: 'not-a-level' as 'read',
      capabilities: undefined,
    });
    expect(bad.maxLevel).toBe('read');
  });

  it('resolveRolePolicy admin always factory; missing stored → factory', () => {
    const adminDirty = resolveRolePolicy('admin', {
      maxLevel: 'read',
      capabilities: ['dashboard.read'],
    });
    expect(adminDirty.dirty).toBe(false);
    expect(hasCapability(adminDirty.policy.capabilities, 'users.manage')).toBe(true);

    const missing = resolveRolePolicy('viewer', null);
    expect(missing.dirty).toBe(false);
    expect(missing.policy.maxLevel).toBe('read');

    const exact = resolveRolePolicy('viewer', factoryRolePolicy('viewer'));
    expect(exact.dirty).toBe(false);
    expect(exact.policy.capabilities).toEqual(factoryRolePolicy('viewer').capabilities);
  });

  it('hasCriticalPrivilege requires manage + rbac.policy pair', () => {
    expect(CRITICAL_PRIVILEGE_CAPS).toContain('users.manage');
    expect(hasCriticalPrivilege(['users.manage', 'rbac.policy'])).toBe(true);
    expect(hasCriticalPrivilege(['users.manage'])).toBe(false);
    expect(hasCriticalPrivilege(['rbac.policy', 'settings.system'])).toBe(false);
  });

  it('computeEffectiveCapabilities defaults empty roles to viewer; skips unknown roles', () => {
    const emptyRoles = computeEffectiveCapabilities({ roles: [] });
    expect(hasCapability(emptyRoles, 'dashboard.read')).toBe(true);
    expect(hasCapability(emptyRoles, 'projects.write')).toBe(false);

    const mixed = computeEffectiveCapabilities({
      roles: ['not-a-role' as 'viewer', 'operator'],
      grants: ['not.real', 'backups.restore'],
      revokes: ['updates.apply', 'also.fake'],
    });
    expect(hasCapability(mixed, 'backups.restore')).toBe(true);
    expect(hasCapability(mixed, 'updates.apply')).toBe(false);
  });

  it('hasCapability accepts Set; applyBand refuses enable above maxLevel', () => {
    const set = new Set(factoryRolePolicy('viewer').capabilities);
    expect(hasCapability(set, 'dashboard.read')).toBe(true);
    expect(hasCapability(set, 'users.manage')).toBe(false);

    const base = factoryRolePolicy('operator').capabilities;
    const unchanged = applyBandToCapabilities(base, 'privilege', true, 'write-high');
    // Enabling privilege band above write-high maxLevel is a no-op
    expect(hasCapability(unchanged, 'users.manage')).toBe(false);
    expect(unchanged).toEqual(base);

    // disable above max still strips if present via grant-like list
    const withPriv = applyBandToCapabilities(
      [...base, 'users.manage'],
      'privilege',
      false,
      'write-high',
    );
    expect(hasCapability(withPriv, 'users.manage')).toBe(false);
  });

  it('null custom rolePolicies uses factory for non-admin', () => {
    const caps = computeEffectiveCapabilities({
      roles: ['operator'],
      rolePolicies: { operator: null },
    });
    expect(hasCapability(caps, 'updates.apply')).toBe(true);
  });
});
