import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import {
  DEFAULT_REDIS,
  DEFAULT_MYSQL,
  DEFAULT_POSTGRES,
  loadRedisSettings,
  saveRedisSettings,
  loadSqlSettings,
  saveSqlSettings,
  loadPostgresSettings,
  savePostgresSettings,
  renderRedisConf,
  renderMysqlConf,
  renderPostgresConf,
  applyRedisServiceConfig,
} from './db-service-config.js';
import type { HostExecutor } from '../host/executor.js';

describe('db-service-config', () => {
  it('loads saves and renders confs; apply blocks without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dbcfg-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      expect(loadRedisSettings(db).port).toBe(DEFAULT_REDIS.port);
      const r = saveRedisSettings(db, { port: 6380, maxmemory: '256mb' });
      expect(r.port).toBe(6380);
      expect(renderRedisConf(r)).toContain('port 6380');
      expect(renderRedisConf(r)).toContain('maxmemory');

      const sql = saveSqlSettings(db, 'mysql', { maxConnections: 200 });
      expect(sql.maxConnections).toBe(200);
      expect(loadSqlSettings(db, 'mysql').maxConnections).toBe(200);
      expect(renderMysqlConf(sql, 'mysql')).toContain('max_connections');

      const pg = savePostgresSettings(db, { maxConnections: 50 });
      expect(loadPostgresSettings(db).maxConnections).toBe(50);
      expect(renderPostgresConf(pg)).toContain('max_connections');
      expect(DEFAULT_MYSQL.port).toBe(3306);
      expect(DEFAULT_POSTGRES.port).toBe(5432);

      const host: HostExecutor = {
        executeEnabled: () => false,
        isRoot: () => false,
        pathExists: () => false,
        readFile: async () => '',
        listDir: async () => [],
        writeFile: async () => undefined,
        deletePath: async () => undefined,
        mkdirp: async () => undefined,
        sysInfo: async () => ({}),
        serviceStatus: async () => ({
          stdout: '',
          stderr: '',
          exitCode: 0,
          argv: [],
          dryRun: false,
        }),
        runCommand: async () => ({
          stdout: '',
          stderr: '',
          exitCode: 0,
          argv: [],
          dryRun: false,
        }),
      };
      const apply = await applyRedisServiceConfig({
        db,
        host,
        dataDir: dir,
      });
      expect(apply.blocked).toBe(true);
      expect(apply.ok).toBe(false);
      expect(apply.written.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
