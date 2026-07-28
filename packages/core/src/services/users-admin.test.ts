import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { UserRepository } from '../repositories/user-repo.js';
import { SessionRepository } from '../repositories/session-repo.js';
import { UsersAdminService } from './users-admin.js';
import type { YskDatabase } from '../db/database.js';

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

      expect(() =>
        svc.impersonate(u.id, { id: 'x', username: 'op1', roles: ['operator'] }),
      ).toThrow(/admin/);

      expect(svc.deleteUser(u.id, 'admin')).toBe(true);
      expect(() => svc.deleteUser('admin1', 'admin')).toThrow(/最後一個 admin/);
      expect(svc.deletePackage(pkg.id, 'admin')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
