import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { HostManifest } from 'ysk-server-shared';
import { JsonStore } from '../../db/store.js';
import { createMigrateJob } from './job-store.js';
import {
  ensureControlPlaneFiles,
  restoreOnHost,
  restoreOsUser,
  restoreSqlDatabase,
  restoreRedisInstance,
} from './restore.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
  failUseradd?: boolean;
  onRun?: (argv: string[]) => Partial<RunResult> | undefined;
}): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => opts.root ?? true,
    executeEnabled: () => opts.execute ?? true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      const override = opts.onRun?.(argv);
      if (override) return { ...empty(), argv, ...override };
      const script = typeof argv[2] === 'string' ? argv[2] : argv.join(' ');
      if (opts.failUseradd && script.includes('useradd')) {
        return { ...empty(), exitCode: 1, stderr: 'useradd fail', argv };
      }
      if (script.includes('useradd') || script.includes('YSK_USER')) {
        return {
          ...empty(),
          exitCode: 0,
          stdout: 'YSK_USER_CREATED\nYSK_CHOWN_OK\n',
          argv,
        };
      }
      if (script.includes('groupadd') || script.includes('YSK_GRP')) {
        return { ...empty(), exitCode: 0, stdout: 'YSK_GRP_DONE\n', argv };
      }
      // Redis restore (must be before generic chown — script also contains chown)
      if (
        script.includes('YSK_RDB_RESTORED') ||
        script.includes('dump.rdb') ||
        (script.includes('cp -a') && script.includes('.rdb'))
      ) {
        return {
          ...empty(),
          exitCode: 0,
          stdout: 'YSK_RDB_RESTORED\n',
          argv,
        };
      }
      if (script.includes('redis') || script.includes('PONG')) {
        return {
          ...empty(),
          exitCode: 0,
          stdout: 'PONG\n',
          argv,
        };
      }
      if (script.includes('chown')) {
        return { ...empty(), exitCode: 0, stdout: 'YSK_CHOWN_OK\n', argv };
      }
      // mysql/psql import
      if (
        script.includes('mysql') ||
        script.includes('mariadb') ||
        script.includes('psql') ||
        script.includes('createdb')
      ) {
        return { ...empty(), exitCode: 0, stdout: 'ok\n', argv };
      }
      return { ...empty(), argv };
    },
  };
}

function baseManifest(dataDir: string): HostManifest {
  const home = join(dataDir, 'home-proj');
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    packagedAt: new Date().toISOString(),
    source: {
      hostname: 's',
      os: 'linux',
      arch: 'x64',
      dataDir,
      yskVersion: '0.1.0',
      nodeVersion: process.version,
    },
    counts: {
      projects: 1,
      users: 1,
      mailboxes: 0,
      email_domains: 0,
      mysql_databases: 1,
      postgres_databases: 0,
      redis_instances: 1,
    },
    projects: [
      {
        id: 'p1',
        name: 'demo',
        home_dir: home,
        linux_user: 'ysks_demo',
        linux_group: 'ysks_demo',
        runtime: 'node',
        homeExists: true,
        uid: 1500,
        gid: 1500,
      },
    ],
    databases: [
      {
        engine: 'mysql',
        name: 'app_db',
        username: 'root',
        dumpRelPath: 'db-dumps/migrate/job/sql/mysql-app_db.sql',
        bytes: 20,
      },
    ],
    redis: [
      {
        id: 'r1',
        rdbRelPath: 'db-dumps/migrate/job/redis/r1.rdb',
        bytes: 12,
      },
    ],
    mailboxes: [],
    emailDomains: [],
    softwareNeeded: ['nginx'],
    paths: {
      dataDir,
      homes: [home],
      optionalEtc: [],
      dataDirCritical: [],
    },
    fingerprints: {},
    warnings: [],
    exclusions: [],
    cutoverHostnames: ['demo.example'],
  };
}

describe('ensureControlPlaneFiles', () => {
  it('fails without ysk.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cp-'));
    const r = ensureControlPlaneFiles(dir);
    expect(r.ok).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('restoreOsUser / restoreSql', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-rs-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('blocks useradd without execute', async () => {
    const r = await restoreOsUser({
      host: mockHost({ execute: false }),
      project: {
        id: 'p',
        name: 'n',
        home_dir: join(dir, 'h'),
        linux_user: 'ysks_x',
        runtime: 'node',
        homeExists: false,
      },
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('creates user when execute+root', async () => {
    const home = join(dir, 'h');
    mkdirSync(home, { recursive: true });
    const r = await restoreOsUser({
      host: mockHost({ execute: true, root: true }),
      project: {
        id: 'p',
        name: 'n',
        home_dir: home,
        linux_user: 'ysks_x',
        linux_group: 'ysks_x',
        runtime: 'node',
        homeExists: true,
        uid: 1600,
        gid: 1600,
      },
    });
    expect(r.ok).toBe(true);
  });

  it('imports sql when dump present', async () => {
    const rel = 'db-dumps/migrate/job/sql/mysql-app_db.sql';
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, 'CREATE TABLE t(i int);\n');
    const r = await restoreSqlDatabase({
      host: mockHost({ execute: true }),
      dataDir: dir,
      db: { engine: 'mysql', name: 'app_db', dumpRelPath: rel },
    });
    expect(r.ok).toBe(true);
  });

  it('sql/redis missing path and postgres/mariadb engines', async () => {
    expect(
      (
        await restoreSqlDatabase({
          host: mockHost({ execute: true }),
          dataDir: dir,
          db: { engine: 'mysql', name: 'x' },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await restoreSqlDatabase({
          host: mockHost({ execute: true }),
          dataDir: dir,
          db: { engine: 'mysql', name: 'x', dumpRelPath: 'missing.sql' },
        })
      ).ok,
    ).toBe(false);

    const pgRel = 'db-dumps/pg.sql';
    mkdirSync(join(dir, 'db-dumps'), { recursive: true });
    writeFileSync(join(dir, pgRel), 'SELECT 1;\n');
    const pg = await restoreSqlDatabase({
      host: mockHost({ execute: true }),
      dataDir: dir,
      db: { engine: 'postgres', name: 'app_pg', dumpRelPath: pgRel, username: 'u' },
      resolvePassword: () => 'pw',
    });
    expect(pg.kind).toBe('sql');

    const maRel = 'db-dumps/maria.sql';
    writeFileSync(join(dir, maRel), 'SELECT 1;\n');
    const ma = await restoreSqlDatabase({
      host: mockHost({ execute: true }),
      dataDir: dir,
      db: { engine: 'mariadb', name: 'app_maria', dumpRelPath: maRel },
    });
    expect(ma.kind).toBe('sql');

    expect(
      (
        await restoreRedisInstance({
          host: mockHost({ execute: true }),
          dataDir: dir,
          redis: { id: 'r1' },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await restoreRedisInstance({
          host: mockHost({ execute: true }),
          dataDir: dir,
          redis: { id: 'r1', rdbRelPath: 'no.rdb' },
        })
      ).ok,
    ).toBe(false);
    const rdbRel = 'redis/dump.rdb';
    mkdirSync(join(dir, 'redis'), { recursive: true });
    writeFileSync(join(dir, rdbRel), 'REDIS');
    expect(
      (
        await restoreRedisInstance({
          host: mockHost({ execute: false }),
          dataDir: dir,
          redis: { id: 'r1', rdbRelPath: rdbRel },
        })
      ).blocked,
    ).toBe(true);
    const redisOk = await restoreRedisInstance({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          const j = argv.join(' ');
          if (j.includes('CONFIG GET')) {
            return {
              stdout: 'dir\n/tmp/redis-data\ndbfilename\ncustom.rdb\n',
              exitCode: 0,
            };
          }
          if (j.includes('YSK_RDB_RESTORED')) {
            return { stdout: 'YSK_RDB_RESTORED\n', exitCode: 0 };
          }
          if (j.includes('ping') || j.includes('start')) {
            return { stdout: 'PONG\n', exitCode: 0 };
          }
          return { stdout: 'ok\n', exitCode: 0 };
        },
      }),
      dataDir: dir,
      redis: { id: 'r2', rdbRelPath: rdbRel },
      redisHost: '127.0.0.1',
      redisPort: 6380,
    });
    expect(redisOk.ok).toBe(true);

    const redisFail = await restoreRedisInstance({
      host: mockHost({
        execute: true,
        onRun: () => ({ stdout: 'fail', exitCode: 1 }),
      }),
      dataDir: dir,
      redis: { id: 'r3', rdbRelPath: rdbRel },
    });
    expect(redisFail.ok).toBe(false);
  });
});

describe('restoreOnHost', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-roh-'));
    writeFileSync(join(dir, 'ysk.json'), '{"version":3}\n');
    mkdirSync(join(dir, 'secrets', 'ssh'), { recursive: true });
    writeFileSync(join(dir, 'secrets', 'ssh', '.master.key'), 'k');
    const m = baseManifest(dir);
    mkdirSync(m.projects[0]!.home_dir, { recursive: true });
    writeFileSync(join(m.projects[0]!.home_dir, 'x'), '1');
    const sql = join(dir, m.databases[0]!.dumpRelPath!);
    mkdirSync(join(sql, '..'), { recursive: true });
    writeFileSync(sql, 'SELECT 1;\n');
    const rdb = join(dir, m.redis[0]!.rdbRelPath!);
    mkdirSync(join(rdb, '..'), { recursive: true });
    writeFileSync(rdb, 'REDIS');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('blocks without execute', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const r = await restoreOnHost({
      host: mockHost({ execute: false }),
      dataDir: dir,
      job,
      manifest: baseManifest(dir),
      db: store,
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('full restore success path', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const r = await restoreOnHost({
      host: mockHost({ execute: true, root: true }),
      dataDir: dir,
      job,
      manifest: baseManifest(dir),
      db: store,
    });
    expect(r.ok).toBe(true);
    expect(r.items.some((i) => i.kind === 'os-user' && i.ok)).toBe(true);
    expect(r.items.some((i) => i.kind === 'sql' && i.ok)).toBe(true);
    expect(r.items.some((i) => i.kind === 'redis' && i.ok)).toBe(true);
    expect(existsSync(join(dir, 'ysk.json'))).toBe(true);
  });
});
