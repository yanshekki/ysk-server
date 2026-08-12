import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { factoryRolePolicy, hasCapability } from 'ysk-server-shared';
// factoryRolePolicy used for subset-upgrade fixture
import { openDatabase } from '../db/database.js';
import { RbacPolicyService } from './rbac-policy.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ysk-rbac-'));
  const db = openDatabase(join(dir, 'ysk.json'));
  const now = new Date().toISOString();
  db.snapshot.users.push({
    id: 'admin-1',
    username: 'admin',
    password_hash: 'x',
    password_salt: 'y',
    roles: ['admin'],
    locale: 'zh-HK',
    created_at: now,
    updated_at: now,
  });
  db.snapshot.users.push({
    id: 'op-1',
    username: 'op1',
    password_hash: 'x',
    password_salt: 'y',
    roles: ['operator'],
    locale: 'zh-HK',
    created_at: now,
    updated_at: now,
  });
  db.persist();
  const svc = new RbacPolicyService(db);
  return { db, svc };
}

describe('RbacPolicyService', () => {
  let db: ReturnType<typeof openDatabase>;
  let svc: RbacPolicyService;

  beforeEach(() => {
    ({ db, svc } = setup());
  });

  it('factory: admin has privilege, operator does not', () => {
    const admin = db.snapshot.users[0]!;
    const op = db.snapshot.users[1]!;
    expect(svc.actorCan(admin, 'users.manage')).toBe(true);
    expect(svc.actorCan(admin, 'rbac.policy')).toBe(true);
    expect(svc.actorCan(op, 'users.manage')).toBe(false);
    expect(svc.actorCan(op, 'updates.apply')).toBe(true);
    expect(svc.actorCan(op, 'backups.restore')).toBe(false);
  });

  it('can grant operator backups.restore via role policy', () => {
    const admin = db.snapshot.users[0]!;
    const base = factoryRolePolicy('operator');
    svc.setRolePolicy(
      'operator',
      {
        maxLevel: 'destructive',
        capabilities: [...base.capabilities, 'backups.restore'],
      },
      {
        id: admin.id,
        username: admin.username,
        roles: admin.roles,
      },
    );
    const op = db.snapshot.users[1]!;
    expect(svc.actorCan(op, 'backups.restore')).toBe(true);
    const view = svc.listPolicies().find((p) => p.role === 'operator')!;
    expect(view.dirty).toBe(true);
  });

  it('restore role returns to factory', () => {
    const admin = db.snapshot.users[0]!;
    svc.setRolePolicy(
      'operator',
      {
        maxLevel: 'destructive',
        capabilities: [...factoryRolePolicy('operator').capabilities, 'backups.restore'],
      },
      { id: admin.id, username: admin.username, roles: admin.roles },
    );
    svc.restoreRole('operator', {
      id: admin.id,
      username: admin.username,
      roles: admin.roles,
    });
    const op = db.snapshot.users[1]!;
    expect(svc.actorCan(op, 'backups.restore')).toBe(false);
    expect(svc.listPolicies().find((p) => p.role === 'operator')!.dirty).toBe(false);
  });

  it('per-user grant/revoke and restore overrides', () => {
    const admin = db.snapshot.users[0]!;
    svc.setUserOverrides(
      'op-1',
      { grants: ['backups.restore'], revokes: ['updates.apply'] },
      { id: admin.id, username: admin.username, roles: admin.roles },
    );
    let op = db.snapshot.users.find((u) => u.id === 'op-1')!;
    expect(svc.actorCan(op, 'backups.restore')).toBe(true);
    expect(svc.actorCan(op, 'updates.apply')).toBe(false);

    svc.restoreUserOverrides('op-1', {
      id: admin.id,
      username: admin.username,
      roles: admin.roles,
    });
    op = db.snapshot.users.find((u) => u.id === 'op-1')!;
    expect(svc.actorCan(op, 'backups.restore')).toBe(false);
    expect(svc.actorCan(op, 'updates.apply')).toBe(true);
  });

  it('refuses any edit to admin role (always full-open)', () => {
    const admin = db.snapshot.users[0]!;
    expect(() =>
      svc.setRolePolicy(
        'admin',
        { maxLevel: 'read', capabilities: ['dashboard.read'] },
        { id: admin.id, username: admin.username, roles: admin.roles },
      ),
    ).toThrow(/admin|權限|last|manage|不可|不能|failed|validation|YSK/i);
  });

  it('admin ignores capability revokes and stays full-open', () => {
    const admin = db.snapshot.users[0]!;
    admin.capability_revokes = ['users.manage', 'rbac.policy', 'backups.restore'];
    expect(svc.actorCan(admin, 'users.manage')).toBe(true);
    expect(svc.actorCan(admin, 'rbac.policy')).toBe(true);
    expect(svc.actorCan(admin, 'backups.restore')).toBe(true);
  });

  it('ensureFullPrivilegeHolder repairs when no holder', () => {
    // Demote only admin to operator without admin role
    const admin = db.snapshot.users[0]!;
    admin.roles = ['operator'];
    db.persist();
    expect(svc.actorCan(admin, 'users.manage')).toBe(false);
    const r = svc.ensureFullPrivilegeHolder();
    expect(r.ok).toBe(true);
    expect(r.repaired).toBe(true);
    const fixed = db.snapshot.users[0]!;
    expect(fixed.roles.includes('admin')).toBe(true);
    expect(svc.actorCan(fixed, 'users.manage')).toBe(true);
  });

  it('operator without rbac.policy cannot set policy', () => {
    const op = db.snapshot.users[1]!;
    expect(() =>
      svc.setRolePolicy(
        'viewer',
        { maxLevel: 'read', capabilities: ['dashboard.read'] },
        { id: op.id, username: op.username, roles: op.roles },
      ),
    ).toThrow();
  });

  it('effective caps sorted list includes catalog privilege for admin', () => {
    const caps = svc.effectiveForUser(db.snapshot.users[0]!);
    expect(hasCapability(caps, 'packages.manage')).toBe(true);
    expect(hasCapability(caps, 'users.impersonate')).toBe(true);
  });

  it('subset of factory stored policy upgrades (not dirty)', () => {
    const factory = factoryRolePolicy('operator');
    db.snapshot.rbac_policies = {
      operator: {
        maxLevel: factory.maxLevel,
        capabilities: factory.capabilities.filter((c) => c !== 'backups.run'),
        defaultsVersion: 0,
      },
    };
    db.persist();
    const view = svc.listPolicies().find((p) => p.role === 'operator')!;
    expect(view.dirty).toBe(false);
    expect(hasCapability(view.policy.capabilities, 'backups.run')).toBe(true);
    expect(svc.actorCan(db.snapshot.users[1]!, 'backups.run')).toBe(true);
  });
});
