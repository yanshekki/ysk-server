import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { HostManifest } from '@ysk-server/shared';
import { JsonStore } from '../../db/store.js';
import { createMigrateJob } from './job-store.js';
import {
  packageSourceForMigrate,
  packageSqlDumps,
  migratePackageDir,
} from './package-source.js';
import { dumpRedisRdb } from './redis-dump.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts: {
  execute?: boolean;
  /** Write dump files when mysqldump/pg_dump/--rdb simulated */
  writeOnDump?: boolean;
  failSql?: boolean;
  failRedis?: boolean;
}): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => true,
    executeEnabled: () => opts.execute ?? true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      const script = typeof argv[2] === 'string' ? argv[2] : argv.join(' ');
      // systemctl stop
      if (script.includes('systemctl stop') || argv.includes('systemctl')) {
        return { ...empty(), stdout: 'done\n', argv };
      }
      if (script.includes('command -v redis-cli')) {
        return { ...empty(), stdout: 'ok\n', argv };
      }
      // Simulate dump tools writing the redirected file
      if (opts.writeOnDump) {
        // mysqldump style: ... > "/path/file.sql"
        const redir = script.match(/>\s*("([^"]+\.sql)"|'([^']+\.sql)'|(\S+\.sql))/);
        const sqlPath = redir?.[2] || redir?.[3] || redir?.[4];
        if (sqlPath && !opts.failSql) {
          mkdirSync(join(sqlPath, '..'), { recursive: true });
          writeFileSync(sqlPath, '-- mock dump\nSELECT 1;\n');
          return { ...empty(), exitCode: 0, argv };
        }
        if (sqlPath && opts.failSql) {
          return { ...empty(), exitCode: 1, stderr: 'dump failed', argv };
        }
        // pg_dump -f "path"
        const pg = script.match(/-f\s+("([^"]+\.sql)"|'([^']+\.sql)')/);
        const pgPath = pg?.[2] || pg?.[3];
        if (pgPath && !opts.failSql) {
          mkdirSync(join(pgPath, '..'), { recursive: true });
          writeFileSync(pgPath, '-- pg mock\n');
          return { ...empty(), exitCode: 0, argv };
        }
        // redis-cli --rdb "path"
        const rdb = script.match(/--rdb\s+("([^"]+\.rdb)"|'([^']+\.rdb)')/);
        const rdbPath = rdb?.[2] || rdb?.[3];
        if (rdbPath) {
          if (opts.failRedis) {
            return { ...empty(), exitCode: 1, stderr: 'NOAUTH', argv };
          }
          mkdirSync(join(rdbPath, '..'), { recursive: true });
          writeFileSync(rdbPath, 'REDIS0009 mock');
          return { ...empty(), exitCode: 0, argv };
        }
      }
      if (opts.failSql && (script.includes('mysqldump') || script.includes('pg_dump'))) {
        return { ...empty(), exitCode: 1, stderr: 'fail', argv };
      }
      if (opts.failRedis && script.includes('redis-cli')) {
        return { ...empty(), exitCode: 1, stderr: 'fail', argv };
      }
      return { ...empty(), argv };
    },
  };
}

function baseManifest(dataDir: string): HostManifest {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    source: {
      hostname: 'src',
      os: 'linux',
      arch: 'x64',
      dataDir,
      yskVersion: '0.1.0',
      nodeVersion: process.version,
    },
    counts: { projects: 1 },
    projects: [
      {
        id: 'p1',
        name: 'demo',
        home_dir: join(dataDir, 'homes', 'p1'),
        linux_user: 'ysks_p1',
        runtime: 'node',
        homeExists: false,
      },
    ],
    databases: [
      { engine: 'mysql', name: 'app_db', username: 'app' },
      { engine: 'postgres', name: 'pg_app', username: 'postgres' },
    ],
    redis: [{ id: 'r1', name: 'cache' }],
    mailboxes: [],
    emailDomains: [],
    softwareNeeded: [],
    paths: {
      dataDir,
      homes: [],
      optionalEtc: [],
      dataDirCritical: [],
    },
    fingerprints: {},
    warnings: [],
    exclusions: [],
    cutoverHostnames: [],
  };
}

describe('dumpRedisRdb', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-rdb-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('blocks without execute', async () => {
    const r = await dumpRedisRdb({
      host: mockHost({ execute: false }),
      outputPath: join(dir, 'x.rdb'),
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('writes rdb via --rdb simulation', async () => {
    const out = join(dir, 'dump.rdb');
    const r = await dumpRedisRdb({
      host: mockHost({ execute: true, writeOnDump: true }),
      outputPath: out,
    });
    expect(r.ok).toBe(true);
    expect(existsSync(out)).toBe(true);
    expect(r.method).toBe('rdb-flag');
  });
});

describe('packageSqlDumps', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-pkg-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('dumps mysql+postgres into package dir', async () => {
    const pkg = join(dir, 'db-dumps', 'migrate', 'job1');
    const m = baseManifest(dir);
    const r = await packageSqlDumps({
      host: mockHost({ execute: true, writeOnDump: true }),
      dataDir: dir,
      packageDir: pkg,
      manifest: m,
    });
    expect(r.ok).toBe(true);
    expect(r.databases.every((d) => d.dumpRelPath)).toBe(true);
    expect(existsSync(join(pkg, 'sql', 'mysql-app_db.sql'))).toBe(true);
    expect(existsSync(join(pkg, 'sql', 'postgres-pg_app.sql'))).toBe(true);
  });

  it('fails closed when dump empty', async () => {
    const pkg = join(dir, 'pkg');
    const r = await packageSqlDumps({
      host: mockHost({ execute: true, writeOnDump: true, failSql: true }),
      dataDir: dir,
      packageDir: pkg,
      manifest: baseManifest(dir),
    });
    expect(r.ok).toBe(false);
  });
});

describe('packageSourceForMigrate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-ps-'));
    writeFileSync(join(dir, 'ysk.json'), '{"version":3}\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('blocks without execute', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({
      dataDir: dir,
      maintenanceAccepted: true,
    });
    const r = await packageSourceForMigrate({
      host: mockHost({ execute: false }),
      db: store,
      dataDir: dir,
      job,
      manifest: baseManifest(dir),
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('blocks without maintenanceAccepted', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({
      dataDir: dir,
      maintenanceAccepted: false,
    });
    const r = await packageSourceForMigrate({
      host: mockHost({ execute: true, writeOnDump: true }),
      db: store,
      dataDir: dir,
      job,
      manifest: baseManifest(dir),
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.notes.join(' ')).toMatch(/維護窗|maintenance/i);
  });

  it('full package success updates manifest fingerprints', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({
      dataDir: dir,
      maintenanceAccepted: true,
    });
    const r = await packageSourceForMigrate({
      host: mockHost({ execute: true, writeOnDump: true }),
      db: store,
      dataDir: dir,
      job,
      manifest: baseManifest(dir),
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('written');
    expect(r.manifest.packagedAt).toBeTruthy();
    expect(r.manifest.databases[0]?.dumpRelPath).toMatch(/db-dumps\/migrate\//);
    expect(r.manifest.redis[0]?.rdbRelPath).toMatch(/\.rdb$/);
    expect(r.manifest.fingerprints['package-dumps']).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(migratePackageDir(dir, job.id), 'package.json'))).toBe(
      true,
    );
    const meta = JSON.parse(
      readFileSync(join(migratePackageDir(dir, job.id), 'package.json'), 'utf8'),
    );
    expect(meta.jobId).toBe(job.id);
  });

  it('partial dump failure → ok false phase failed', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({
      dataDir: dir,
      maintenanceAccepted: true,
    });
    const r = await packageSourceForMigrate({
      host: mockHost({ execute: true, writeOnDump: true, failRedis: true }),
      db: store,
      dataDir: dir,
      job,
      manifest: baseManifest(dir),
    });
    expect(r.ok).toBe(false);
    expect(job.phase === 'failed' || r.notes.some((n) => n.includes('失敗'))).toBe(
      true,
    );
  });
});
