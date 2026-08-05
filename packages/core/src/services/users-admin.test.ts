import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { UserRepository } from '../repositories/user-repo.js';
import { SessionRepository } from '../repositories/session-repo.js';
import { UsersAdminService } from './users-admin.js';
import type { YskDatabase } from '../db/database.js';
import type { AuditRepository } from '../repositories/audit-repo.js';

describe('UsersAdminService', () => {
  it('manages users packages and impersonate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-users-admin-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      // seed admin so delete last-admin rule can be tested
      store.snapshot.users = [
        {
          id: 'admin1',
          username: 'admin',
          password_hash: 'h',
          password_salt: 's',
          roles: ['admin'],
          locale: 'zh-TW',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      store.persist();
      const db = store as unknown as YskDatabase;
      const svc = new UsersAdminService(
        new UserRepository(db),
        new SessionRepository(db),
        db,
      );

      expect(svc.listUsers()).toHaveLength(1);
      expect(() =>
        svc.createUser({ username: 'Bad Name', password: 'password1', actor: 'admin' }),
      ).toThrow();
      expect(() =>
        svc.createUser({ username: 'op1', password: 'short', actor: 'admin' }),
      ).toThrow(/8/);

      const u = svc.createUser({
        username: 'op1',
        password: 'password1',
        roles: ['operator'],
        actor: 'admin',
      });
      expect(u.username).toBe('op1');
      expect(svc.listUsers()).toHaveLength(2);

      const pkg = svc.createPackage({ name: 'basic', maxProjects: 3 }, 'admin');
      expect(pkg.name).toBe('basic');
      expect(svc.listPackages()).toHaveLength(1);
      svc.updatePackage(pkg.id, { max_projects: 5 }, 'admin');
      expect(svc.listPackages()[0].max_projects).toBe(5);

      svc.updateUser(u.id, { packageId: pkg.id, suspended: false }, 'admin');
      const imp = svc.impersonate(u.id, {
        id: 'admin1',
        username: 'admin',
        roles: ['admin'],
      });
      expect(imp.token.length).toBeGreaterThan(10);
      expect(imp.user.username).toBe('op1');

      // Package with subscribers cannot be deleted
      expect(() => svc.deletePackage(pkg.id, 'admin')).toThrow();

      expect(svc.deleteUser(u.id, 'admin')).toBe(true);
      expect(() => svc.deleteUser('admin1', 'admin')).toThrow(/最後一個|last|admin|管理員/i);
      expect(svc.deletePackage(pkg.id, 'admin')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('covers error and optional-audit branches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-users-admin-br-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      store.snapshot.users = [
        {
          id: 'admin1',
          username: 'admin',
          password_hash: 'h',
          password_salt: 's',
          roles: ['admin'],
          locale: 'zh-HK',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      // packages missing → listPackages coalesces
      delete (store.snapshot as { packages?: unknown }).packages;
      store.persist();
      const auditCalls: Array<Record<string, unknown>> = [];
      const audit = {
        append: (e: Record<string, unknown>) => {
          auditCalls.push(e);
        },
      } as unknown as AuditRepository;
      const db = store as unknown as YskDatabase;
      const users = new UserRepository(db);
      const sessions = new SessionRepository(db);
      const svc = new UsersAdminService(users, sessions, db, audit);

      expect(svc.listPackages()).toEqual([]);
      expect(svc.listUsers()[0]!.mustChangePassword).toBeUndefined();

      // default roles when empty / not admin
      const u = svc.createUser({
        username: 'opx',
        password: 'password1',
        roles: [],
        actor: 'admin',
        locale: 'en',
      });
      expect(u.roles).toContain('operator');
      expect(u.locale).toBe('en');

      // duplicate username
      expect(() =>
        svc.createUser({ username: 'opx', password: 'password1', actor: 'admin' }),
      ).toThrow();

      // update missing
      expect(() => svc.updateUser('nope', { suspended: true }, 'admin')).toThrow();
      // short password on update
      expect(() => svc.updateUser(u.id, { password: 'short' }, 'admin')).toThrow(/8/);
      // clear packageId + set password + suspend flags
      svc.updateUser(
        u.id,
        { packageId: null, password: 'password99', suspended: true, roles: ['viewer'] },
        'admin',
      );
      const listed = svc.listUsers().find((x) => x.id === u.id)!;
      expect(listed.suspended).toBe(true);
      expect(listed.roles).toContain('viewer');

      // impersonate missing / suspended
      expect(() =>
        svc.impersonate('missing', { id: 'admin1', username: 'admin', roles: ['admin'] }),
      ).toThrow();
      expect(() =>
        svc.impersonate(u.id, { id: 'admin1', username: 'admin', roles: ['admin'] }),
      ).toThrow();

      // unsuspend then package branches
      svc.updateUser(u.id, { suspended: false }, 'admin');
      expect(() => svc.createPackage({ name: '   ' }, 'admin')).toThrow();
      const pkg = svc.createPackage(
        {
          name: 'pro',
          maxProjects: 1,
          maxMailboxes: 2,
          maxDatabases: 3,
          diskMb: 100,
          bandwidthMb: 50,
          allowSsh: true,
          allowFtp: false,
          notes: 'n',
        },
        'admin',
      );
      expect(pkg.allow_ssh).toBe(true);
      expect(pkg.allow_ftp).toBe(false);
      expect(() => svc.updatePackage('missing', { name: 'x' }, 'admin')).toThrow();
      svc.updatePackage(pkg.id, { name: 'pro2' }, 'admin');
      expect(svc.deleteUser('missing-id', 'admin')).toBe(false);
      expect(svc.deletePackage('missing-pkg', 'admin')).toBe(false);

      // delete package with no packages array edge — ensure packages exists then empty delete
      expect(svc.deletePackage(pkg.id, 'admin')).toBe(true);
      expect(auditCalls.length).toBeGreaterThan(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
