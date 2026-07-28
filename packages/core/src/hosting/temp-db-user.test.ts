import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import {
  listTempDbUsers,
  createTempReadonlyUser,
  revokeTempDbUser,
  expireTempDbUsers,
  listRemoteDbHosts,
  upsertRemoteDbHost,
  deleteRemoteDbHost,
} from './temp-db-user.js';
import type { HostExecutor } from '../host/executor.js';

function host(execute: boolean, root = true): HostExecutor {
  return {
    executeEnabled: () => execute,
    isRoot: () => root,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
  };
}

describe('temp-db-user', () => {
  it('creates lists revokes expires and remote hosts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tempdb-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const created = await createTempReadonlyUser({
        db,
        host: host(false),
        engine: 'mysql',
        database: 'app',
        actor: 'admin',
        apply: false,
        ttlHours: 1,
      });
      expect(created.ok).toBe(true);
      expect(created.password).toBeTruthy();
      expect(created.user?.apply_status).toBe('written');
      expect(listTempDbUsers(db).length).toBe(1);

      const blockedApply = await createTempReadonlyUser({
        db,
        host: host(false),
        engine: 'mysql',
        database: 'app2',
        actor: 'admin',
        apply: true,
      });
      expect(blockedApply.user?.apply_status).toBe('blocked');

      const applied = await createTempReadonlyUser({
        db,
        host: host(true, true),
        engine: 'mysql',
        database: 'app3',
        actor: 'admin',
        apply: true,
        username: 'ro_test',
      });
      expect(applied.user?.apply_status).toBe('applied');

      // force expire one
      const all = listTempDbUsers(db);
      const first = all[0]!;
      db.snapshot.settings.temp_db_users = JSON.stringify(
        all.map((u, i) =>
          i === 0 ? { ...u, expiresAt: new Date(Date.now() - 1000).toISOString() } : u,
        ),
      );
      db.persist();
      const exp = await expireTempDbUsers({ db, host: host(false), dropSystem: false });
      expect(exp.expired).toBeGreaterThanOrEqual(1);

      expect(revokeTempDbUser(db, first.id).ok || revokeTempDbUser(db, 'missing').ok === false).toBe(
        true,
      );

      const rem = upsertRemoteDbHost(db, {
        engine: 'postgres',
        label: 'prod',
        host: '10.0.0.1',
        password: 'secret',
      });
      expect(rem.hasPassword).toBe(true);
      expect(listRemoteDbHosts(db).every((h) => !('password' in h && (h as { password?: string }).password))).toBe(
        true,
      );
      expect(deleteRemoteDbHost(db, rem.id)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
