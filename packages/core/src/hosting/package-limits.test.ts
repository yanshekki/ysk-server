import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import {
  assertCanCreateProject,
  assertCanCreateMailbox,
  assertCanCreateDatabase,
  getUserPackage,
  hostPackageUsage,
  userPackageUsage,
} from './package-limits.js';
import type { YskDatabase } from '../db/database.js';

function dbWithPkg(dir: string) {
  const store = new JsonStore(join(dir, 'db.json'));
  store.snapshot.packages = [
    {
      id: 'pkg1',
      name: 'starter',
      max_projects: 1,
      max_mailboxes: 1,
      max_databases: 1,
      disk_mb: 1024,
      bandwidth_mb: 0,
      allow_ssh: false,
      allow_ftp: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
  store.snapshot.users = [
    {
      id: 'u1',
      username: 'bob',
      password_hash: 'x',
      password_salt: 'y',
      roles: ['operator'],
      locale: 'zh-HK',
      package_id: 'pkg1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
  store.persist();
  return store as unknown as YskDatabase;
}

describe('package-limits', () => {
  it('host usage and owner-key variants + disk soft limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pkg-host-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      store.snapshot.packages = [
        {
          id: 'pkg1',
          name: 'starter',
          max_projects: 10,
          max_mailboxes: 10,
          max_databases: 10,
          disk_mb: 100,
          bandwidth_mb: 0,
          allow_ssh: false,
          allow_ftp: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      store.snapshot.users = [
        {
          id: 'u1',
          username: 'bob',
          password_hash: 'x',
          password_salt: 'y',
          roles: ['operator'],
          locale: 'zh-HK',
          package_id: 'pkg1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'u2',
          username: 'naked',
          password_hash: 'x',
          password_salt: 'y',
          roles: ['operator'],
          locale: 'zh-HK',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      store.snapshot.projects = [
        {
          id: 'p1',
          name: 'a',
          owner_user_id: 'u1',
          quota_mb: 80,
          linux_user: 'u',
          linux_group: 'g',
          home_dir: '/tmp/a',
          runtime: 'node',
          env: 'production',
          status: 'active',
          os_provisioned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as never;
      store.snapshot.mailboxes = [
        { id: 'm1', ownerUserId: 'u1' },
        { id: 'm2', user_id: 'u1' },
        { id: 'm3', created_by_user_id: 'u1' },
        { id: 'm4' },
      ] as never;
      store.snapshot.mysql_databases = [{ id: 'd1', owner_user_id: 'u1' }] as never;
      store.snapshot.postgres_databases = [{ id: 'd2', userId: 'u1' }] as never;
      store.persist();
      const db = store as unknown as YskDatabase;
      const hostU = hostPackageUsage(db);
      expect(hostU.scope).toBe('host');
      expect(hostU.projects).toBe(1);
      expect(hostU.databases).toBe(2);
      const userU = userPackageUsage(db, 'u1');
      expect(userU.mailboxes).toBe(3);
      expect(userU.databases).toBe(2);
      expect(userU.diskQuotaAssignedMb).toBe(80);
      // disk soft limit: 80 < 100 ok
      assertCanCreateProject(db, 'u1');
      // exceed disk
      (db.snapshot.projects[0] as { quota_mb: number }).quota_mb = 150;
      expect(() => assertCanCreateProject(db, 'u1')).toThrow(/disk|quota|MiB/i);
      // no package / no actor
      assertCanCreateProject(db, undefined);
      assertCanCreateProject(db, 'u2');
      assertCanCreateMailbox(db, undefined);
      assertCanCreateDatabase(db, undefined);
      // max_mailboxes 0 means unlimited in assertCanCreateMailbox when pkg.max_mailboxes <= 0
      db.snapshot.packages![0]!.max_mailboxes = 0;
      assertCanCreateMailbox(db, 'u1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces project/mailbox/db caps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pkg-lim-'));
    try {
      const db = dbWithPkg(dir);
      expect(getUserPackage(db, 'u1')?.name).toBe('starter');
      expect(getUserPackage(db, 'nope')).toBeNull();
      assertCanCreateProject(db, 'u1');
      // Unowned legacy project does NOT count against user
      db.snapshot.projects = [
        {
          id: 'legacy',
          name: 'legacy',
          linux_user: 'u',
          linux_group: 'g',
          home_dir: '/tmp/legacy',
          runtime: 'node',
          env: 'production',
          status: 'active',
          os_provisioned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as never;
      assertCanCreateProject(db, 'u1');
      // Owned project counts toward per-user package
      db.snapshot.projects = [
        {
          id: 'p1',
          name: 'a',
          linux_user: 'u',
          linux_group: 'g',
          home_dir: '/tmp/a',
          runtime: 'node',
          env: 'production',
          status: 'active',
          os_provisioned: false,
          owner_user_id: 'u1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as never;
      expect(() => assertCanCreateProject(db, 'u1')).toThrow(/專案上限|上限|quota|max/i);
      assertCanCreateProject(db); // no actor = skip
      db.snapshot.mailboxes = [{ id: 'm1', owner_user_id: 'u1' }] as never;
      expect(() => assertCanCreateMailbox(db, 'u1')).toThrow(/信箱上限|上限|mailbox/i);
      db.snapshot.mysql_databases = [{ id: 'd1', owner_user_id: 'u1' }] as never;
      expect(() => assertCanCreateDatabase(db, 'u1')).toThrow(/資料庫上限|上限|database/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
