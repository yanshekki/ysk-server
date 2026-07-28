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
      locale: 'zh-TW',
      package_id: 'pkg1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
  store.persist();
  return store as unknown as YskDatabase;
}

describe('package-limits', () => {
  it('enforces project/mailbox/db caps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pkg-lim-'));
    try {
      const db = dbWithPkg(dir);
      expect(getUserPackage(db, 'u1')?.name).toBe('starter');
      expect(getUserPackage(db, 'nope')).toBeNull();
      assertCanCreateProject(db, 'u1');
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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as never;
      expect(() => assertCanCreateProject(db, 'u1')).toThrow(/專案上限/);
      assertCanCreateProject(db); // no actor = skip
      db.snapshot.mailboxes = [{ id: 'm1' }] as never;
      expect(() => assertCanCreateMailbox(db, 'u1')).toThrow(/信箱上限/);
      db.snapshot.mysql_databases = [{ id: 'd1' }] as never;
      expect(() => assertCanCreateDatabase(db, 'u1')).toThrow(/資料庫上限/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
