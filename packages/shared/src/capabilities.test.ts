import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CATALOG,
  applyBandToCapabilities,
  computeEffectiveCapabilities,
  factoryRolePolicy,
  hasCapability,
  isFactoryPolicy,
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
  });

  it('viewer is read-only', () => {
    const v = factoryRolePolicy('viewer');
    expect(v.maxLevel).toBe('read');
    expect(hasCapability(v.capabilities, 'dashboard.read')).toBe(true);
    expect(hasCapability(v.capabilities, 'projects.write')).toBe(false);
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
