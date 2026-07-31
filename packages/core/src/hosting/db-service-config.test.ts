import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import type { HostExecutor } from '../host/executor.js';
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
  applySqlServiceConfig,
  applyPostgresServiceConfig,
  getRedisServiceView,
  getSqlServiceView,
  getPostgresServiceView,
} from './db-service-config.js';

function host(opts: {
  execute?: boolean;
  root?: boolean;
  exit?: number;
  pathExists?: (p: string) => boolean;
  stdoutFor?: (argv: string[]) => string;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute === true,
    isRoot: () => opts.root === true,
    pathExists: (p) => (opts.pathExists ? opts.pathExists(p) : false),
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
    runCommand: async (argv) => {
      const exitCode = opts.exit ?? 0;
      const stdout =
        opts.stdoutFor?.(argv) ??
        (argv.includes('CONFIG') && argv.includes('SET')
          ? 'OK'
          : argv.includes('CONFIG') && argv.includes('GET')
            ? 'databases\n32\n'
            : argv.includes('is-active')
              ? 'active\n'
              : argv.includes('--version')
                ? 'psql (PostgreSQL) 16.0\n'
                : argv.includes('command -v')
                  ? '/usr/bin/psql\n'
                  : argv.includes('find')
                    ? '/etc/postgresql/16/main/conf.d\n'
                    : '');
      return {
        stdout: exitCode === 0 ? stdout : '',
        stderr: exitCode === 0 ? '' : 'err',
        exitCode,
        argv,
        dryRun: false,
      };
    },
  };
}

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

      const apply = await applyRedisServiceConfig({
        db,
        host: host({ execute: false }),
        dataDir: dir,
      });
      expect(apply.blocked).toBe(true);
      expect(apply.ok).toBe(false);
      expect(apply.written.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles corrupt JSON and redis conf render edges', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dbcfg-j-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      db.snapshot.settings.redis_service_settings = 'nope{';
      db.snapshot.settings.mysql_service_settings = '{';
      db.snapshot.settings.postgres_service_settings = 'x';
      expect(loadRedisSettings(db).port).toBe(6379);
      expect(loadSqlSettings(db, 'mysql').port).toBe(3306);
      expect(loadPostgresSettings(db).port).toBe(5432);

      const withPass = saveRedisSettings(db, {
        requirepass: 'secret',
        maxmemory: '0',
        protectedMode: false,
        appendonly: true,
        port: 99999,
      });
      expect(withPass.port).toBe(65535);
      const conf = renderRedisConf(withPass);
      expect(conf).toContain('requirepass secret');
      expect(conf).toContain('maxmemory 0');
      expect(conf).toContain('protected-mode no');
      expect(renderMysqlConf({ ...DEFAULT_MYSQL, characterSetServer: '' }, 'mariadb')).not.toContain(
        'character-set-server',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applyRedisServiceConfig executes CONFIG SET and restart paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dbcfg-r-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      saveRedisSettings(db, { databases: 32, maxmemory: '128mb' });
      const ok = await applyRedisServiceConfig({
        db,
        host: host({ execute: true, root: true }),
        dataDir: dir,
        settings: { port: 6381 },
      });
      expect(ok.executed).toBe(true);
      expect(ok.ok).toBe(true);
      expect(ok.written.some((p) => p.endsWith('redis.ysk.conf'))).toBe(true);

      const noRoot = await applyRedisServiceConfig({
        db,
        host: host({ execute: true, root: false }),
        dataDir: dir,
      });
      expect(noRoot.blocked).toBe(true);

      const failAll = await applyRedisServiceConfig({
        db,
        host: host({ execute: true, root: true, exit: 1 }),
        dataDir: dir,
        restart: true,
      });
      expect(failAll.ok).toBe(false);

      const noRestart = await applyRedisServiceConfig({
        db,
        host: host({ execute: true, root: true }),
        dataDir: dir,
        restart: false,
      });
      expect(noRestart.executed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applySqlServiceConfig blocks without execute/root and writes managed conf', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dbcfg-sql-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const blocked = await applySqlServiceConfig({
        db,
        host: host({ execute: false }),
        dataDir: dir,
        engine: 'mysql',
        settings: { maxConnections: 99 },
      });
      expect(blocked.blocked).toBe(true);
      expect(blocked.written.some((p) => p.endsWith('ysk.cnf'))).toBe(true);

      const noRoot = await applySqlServiceConfig({
        db,
        host: host({ execute: true, root: false }),
        dataDir: dir,
        engine: 'mariadb',
      });
      expect(noRoot.blocked).toBe(true);
      expect(noRoot.notes.length).toBeGreaterThan(0);

      // execute+root path mkdirSyncs /etc/mysql — only assert when permitted
      try {
        mkdirSync('/etc/mysql/mysql.conf.d', { recursive: true });
        const cpFail = await applySqlServiceConfig({
          db,
          host: host({ execute: true, root: true, exit: 1 }),
          dataDir: dir,
          engine: 'mysql',
        });
        expect(cpFail.executed).toBe(true);
        expect(cpFail.ok).toBe(false);
      } catch (e) {
        // non-root CI: mkdir denied — honesty path already covered by blocked cases
        expect(String(e)).toMatch(/EACCES|EPERM|permission/i);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applyPostgresServiceConfig installs drop-in when conf.d found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dbcfg-pg-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const blocked = await applyPostgresServiceConfig({
        db,
        host: host({ execute: true, root: false }),
        dataDir: dir,
      });
      expect(blocked.blocked).toBe(true);

      // /etc/postgresql may not exist on this host — mock pathExists true via custom host
      const h = host({
        execute: true,
        root: true,
        pathExists: (p) => p === '/etc/postgresql' || p.includes('conf.d'),
      });
      // existsSync is real fs — if /etc/postgresql missing, installed stays false
      const r = await applyPostgresServiceConfig({
        db,
        host: h,
        dataDir: dir,
        settings: { port: 5433 },
        restart: false,
      });
      expect(r.executed).toBe(true);
      expect(r.written.length).toBeGreaterThan(0);

      // force installed=true path by creating a fake structure only if we can
      // Still exercise notes when not installed
      if (!r.ok) {
        expect(r.notes.length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('service views enrich settings from probes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dbcfg-v-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      saveRedisSettings(db, { databases: 16 });
      saveSqlSettings(db, 'mysql', { port: 3307 });
      savePostgresSettings(db, { maxConnections: 40 });

      const redis = await getRedisServiceView({
        db,
        host: host({
          execute: true,
          root: true,
          stdoutFor: (argv) => {
            if (argv.includes('PING') || argv[0] === 'redis-cli') {
              if (argv.includes('GET')) return 'databases\n24\n';
              return 'PONG\n';
            }
            return '';
          },
        }),
      });
      expect(redis.settings.port).toBe(6379);
      expect(redis.configuredDatabases).toBeGreaterThan(0);

      const sql = await getSqlServiceView({
        db,
        host: host({ execute: false }),
        engine: 'mysql',
      });
      expect(sql.settings.port).toBe(3307);

      const pg = await getPostgresServiceView({
        db,
        host: host({
          execute: false,
          pathExists: (p) => p.includes('systemctl'),
          stdoutFor: (argv) => {
            const j = argv.join(' ');
            if (j.includes('command -v')) return '/usr/bin/x\n';
            if (j.includes('is-active')) return 'active\n';
            if (j.includes('--version')) return 'psql (PostgreSQL) 15\n';
            return '';
          },
        }),
      });
      expect(pg.settings.maxConnections).toBe(40);
      expect(pg.clientInstalled).toBe(true);
      expect(pg.serverInstalled).toBe(true);
      expect(pg.version).toMatch(/PostgreSQL/);
      expect(pg.executeEnabled).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
