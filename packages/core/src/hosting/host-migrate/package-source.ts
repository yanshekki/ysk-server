/**
 * Package phase: quiesce (optional) + full SQL dumps + Redis RDB.
 * Writes under dataDir/db-dumps/migrate/{jobId}/ and updates HostManifest.
 * Fail-closed: any dump failure → overall ok=false (no transfer).
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type {
  HostManifest,
  HostManifestDatabase,
  HostManifestRedis,
  OpsResultDto,
} from '@yanshekki/shared';
import { assertHonestOps, tl} from '@yanshekki/shared';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { dumpSqlDatabase } from '../db-dump.js';
import { dumpRedisRdb } from './redis-dump.js';
import { migrateJobDir } from './types.js';
import { appendMigrateStep, attachManifest, setMigratePhase } from './job-store.js';
import type { MigrateJobDto } from '@yanshekki/shared';

export type PackageItemResult = {
  kind: 'sql' | 'redis' | 'quiesce' | 'fingerprint';
  name: string;
  ok: boolean;
  path?: string;
  notes: string[];
  blocked?: boolean;
};

export type PackageSourceResult = OpsResultDto & {
  packageDir: string;
  items: PackageItemResult[];
  manifest: HostManifest;
  /** Relative paths written under dataDir */
  writtenRel: string[];
};

function atomicWriteJson(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, path);
}

function fileSha256(path: string): string | undefined {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return undefined;
  }
}

function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function migratePackageDir(dataDir: string, jobId: string): string {
  return join(dataDir, 'db-dumps', 'migrate', jobId);
}

/**
 * Best-effort stop project systemd units / pidfile processes for consistency.
 * Does not fail package if stop fails (notes only) — dumps are still required.
 */
export async function quiesceProjects(input: {
  host: HostExecutor;
  manifest: HostManifest;
}): Promise<PackageItemResult> {
  const notes: string[] = [];
  if (!input.host.executeEnabled()) {
    return {
      kind: 'quiesce',
      name: 'quiesce',
      ok: false,
      blocked: true,
      notes: [tl('notes.auto.n1144')],
    };
  }

  let stopped = 0;
  let failed = 0;
  for (const p of input.manifest.projects) {
    const unit = `ysk-project-${p.id}.service`;
    const r = await input.host.runCommand(
      [
        'bash',
        '-c',
        `systemctl stop ${JSON.stringify(unit)} 2>/dev/null || systemctl stop ${JSON.stringify(unit.replace(/\.service$/, ''))} 2>/dev/null || true; echo done`,
      ],
      { timeoutMs: 30_000 },
    );
    if (r.exitCode === 0) {
      stopped += 1;
    } else {
      failed += 1;
      notes.push(`stop ${unit}: exit=${r.exitCode}`);
    }
  }

  // Optional: FLUSH not used — we dump RDB instead
  notes.unshift(
    tl('notes.auto.t0603', { v0: (input.manifest.projects.length), v1: (stopped) }),
  );
  if (failed) notes.push(tl('notes.auto.t0604', { v0: (failed) }));

  return {
    kind: 'quiesce',
    name: 'quiesce-projects',
    ok: true,
    notes,
  };
}

/**
 * Dump all SQL DBs listed in manifest into packageDir.
 */
export async function packageSqlDumps(input: {
  host: HostExecutor;
  dataDir: string;
  packageDir: string;
  manifest: HostManifest;
  /** Optional password resolver by engine+name */
  resolvePassword?: (
    db: HostManifestDatabase,
  ) => string | undefined;
}): Promise<{
  ok: boolean;
  blocked?: boolean;
  items: PackageItemResult[];
  databases: HostManifestDatabase[];
}> {
  const items: PackageItemResult[] = [];
  const databases: HostManifestDatabase[] = [];
  let blocked = false;

  mkdirSync(join(input.packageDir, 'sql'), { recursive: true });

  if (input.manifest.databases.length === 0) {
    items.push({
      kind: 'sql',
      name: '(none)',
      ok: true,
      notes: [tl('notes.auto.n1064')],
    });
    return { ok: true, items, databases };
  }

  for (const db of input.manifest.databases) {
    if (!db.name) {
      items.push({
        kind: 'sql',
        name: db.id || '?',
        ok: false,
        notes: [tl('notes.auto.n1452')],
      });
      continue;
    }
    const safe = db.name.replace(/[^a-zA-Z0-9_]/g, '_') || 'db';
    const fileName = `${db.engine}-${safe}.sql`;
    const outputPath = join(input.packageDir, 'sql', fileName);
    const password = input.resolvePassword?.(db);
    const r = await dumpSqlDatabase({
      host: input.host,
      dataDir: input.dataDir,
      engine: db.engine,
      dbName: db.name,
      username: db.username,
      password,
      outputPath,
    });
    if (r.blocked) blocked = true;
    const ok = r.ok === true && existsSync(outputPath) && fileBytes(outputPath) > 0;
    const rel = relative(input.dataDir, outputPath).replace(/\\/g, '/');
    items.push({
      kind: 'sql',
      name: `${db.engine}:${db.name}`,
      ok,
      path: ok ? outputPath : undefined,
      notes: r.notes,
      blocked: r.blocked,
    });
    databases.push({
      ...db,
      dumpRelPath: ok ? rel : undefined,
      bytes: ok ? fileBytes(outputPath) : undefined,
    });
  }

  const allOk = items.every((i) => i.ok || i.name === '(none)');
  return { ok: allOk && !blocked, blocked, items, databases };
}

/**
 * Dump all Redis instances from manifest.
 * Multiple registry rows currently share default 127.0.0.1:6379 unless extended later.
 */
export async function packageRedisDumps(input: {
  host: HostExecutor;
  dataDir: string;
  packageDir: string;
  manifest: HostManifest;
  resolveRedis?: (r: HostManifestRedis) => {
    host?: string;
    port?: number;
    password?: string;
  };
}): Promise<{
  ok: boolean;
  blocked?: boolean;
  items: PackageItemResult[];
  redis: HostManifestRedis[];
}> {
  const items: PackageItemResult[] = [];
  const redis: HostManifestRedis[] = [];
  mkdirSync(join(input.packageDir, 'redis'), { recursive: true });

  if (input.manifest.redis.length === 0) {
    items.push({
      kind: 'redis',
      name: '(none)',
      ok: true,
      notes: [tl('notes.auto.n1063')],
    });
    return { ok: true, items, redis };
  }

  let blocked = false;
  // Deduplicate physical endpoints (same host:port dump once)
  const seen = new Set<string>();

  for (const row of input.manifest.redis) {
    const conn = input.resolveRedis?.(row) ?? {};
    const rh = conn.host ?? '127.0.0.1';
    const rp = conn.port ?? 6379;
    const key = `${rh}:${rp}`;
    const safeId = (row.id || 'redis').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${safeId}.rdb`;
    const outputPath = join(input.packageDir, 'redis', fileName);

    if (seen.has(key)) {
      // Point to first dump for same endpoint
      const first = redis.find((x) => x.rdbRelPath);
      items.push({
        kind: 'redis',
        name: row.id,
        ok: true,
        notes: [tl('notes.auto.t0605', { v0: (key) })],
        path: first ? join(input.dataDir, first.rdbRelPath!) : undefined,
      });
      redis.push({
        ...row,
        rdbRelPath: first?.rdbRelPath,
        bytes: first?.bytes,
      });
      continue;
    }
    seen.add(key);

    const r = await dumpRedisRdb({
      host: input.host,
      outputPath,
      redisHost: rh,
      redisPort: rp,
      password: conn.password,
    });
    if (r.blocked) blocked = true;
    const ok = r.ok === true && !!r.path && fileBytes(r.path) > 0;
    const rel = ok
      ? relative(input.dataDir, r.path!).replace(/\\/g, '/')
      : undefined;
    items.push({
      kind: 'redis',
      name: row.id,
      ok,
      path: r.path,
      notes: r.notes,
      blocked: r.blocked,
    });
    redis.push({
      ...row,
      rdbRelPath: rel,
      bytes: ok ? fileBytes(r.path!) : undefined,
    });
  }

  const allOk = items.every((i) => i.ok);
  return { ok: allOk && !blocked, blocked, items, redis };
}

function refreshPackageFingerprints(
  dataDir: string,
  manifest: HostManifest,
  packageDir: string,
): HostManifest {
  const fp = { ...manifest.fingerprints };
  const ysk = join(dataDir, 'ysk.json');
  const h = fileSha256(ysk);
  if (h) fp['dataDir/ysk.json'] = h;

  const dumpList: string[] = [];
  if (existsSync(packageDir)) {
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        try {
          const st = statSync(p);
          if (st.isDirectory()) walk(p);
          else if (st.isFile()) {
            const rel = relative(dataDir, p).replace(/\\/g, '/');
            dumpList.push(`${rel}:${st.size}`);
            const sh = fileSha256(p);
            if (sh) fp[`dump:${rel}`] = sh;
          }
        } catch {
          /* */
        }
      }
    };
    walk(packageDir);
  }
  fp['package-dumps'] = createHash('sha256')
    .update(dumpList.sort().join('\n'), 'utf8')
    .digest('hex');
  fp['databases'] = createHash('sha256')
    .update(
      JSON.stringify(
        manifest.databases.map((d) => `${d.engine}:${d.name}:${d.dumpRelPath ?? ''}`).sort(),
      ),
      'utf8',
    )
    .digest('hex');
  fp['redis'] = createHash('sha256')
    .update(
      JSON.stringify(
        manifest.redis.map((r) => `${r.id}:${r.rdbRelPath ?? ''}`).sort(),
      ),
      'utf8',
    )
    .digest('hex');

  return {
    ...manifest,
    fingerprints: fp,
    packagedAt: new Date().toISOString(),
  };
}

/**
 * Full package phase for a migrate job.
 */
export async function packageSourceForMigrate(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir: string;
  job: MigrateJobDto;
  manifest: HostManifest;
  /** Stop project units before dump (default true) */
  quiesce?: boolean;
  resolveSqlPassword?: (db: HostManifestDatabase) => string | undefined;
  resolveRedis?: (r: HostManifestRedis) => {
    host?: string;
    port?: number;
    password?: string;
  };
}): Promise<PackageSourceResult> {
  const dataDir = resolve(input.dataDir);
  const jobId = input.job.id;
  const packageDir = migratePackageDir(dataDir, jobId);
  const items: PackageItemResult[] = [];
  const writtenRel: string[] = [];

  if (!input.host.executeEnabled()) {
    const manifest = input.manifest;
    return assertHonestOps({
      ok: false,
      blocked: true,
      requiresExecute: true,
      blockMessage: tl('notes.auto.n0531'),
      notes: [tl('notes.auto.n0362')],
      packageDir,
      items: [
        {
          kind: 'quiesce',
          name: 'package',
          ok: false,
          blocked: true,
          notes: ['blocked: no execute'],
        },
      ],
      manifest,
      writtenRel: [],
    }) as PackageSourceResult;
  }

  if (input.job.maintenanceAccepted !== true) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      blockMessage: tl('notes.auto.n0971'),
      notes: [tl('notes.auto.n1381')],
      packageDir,
      items: [],
      manifest: input.manifest,
      writtenRel: [],
    }) as PackageSourceResult;
  }

  mkdirSync(packageDir, { recursive: true });
  setMigratePhase(dataDir, input.job, 'package');

  // 1) Quiesce
  if (input.quiesce !== false) {
    const q = await quiesceProjects({
      host: input.host,
      manifest: input.manifest,
    });
    items.push(q);
    appendMigrateStep(dataDir, input.job, {
      phase: 'package',
      name: 'quiesce-projects',
      result: {
        ok: q.ok,
        blocked: q.blocked,
        apply_status: q.blocked ? 'blocked' : q.ok ? 'applied' : 'failed',
        notes: q.notes,
      },
    });
    if (q.blocked) {
      return assertHonestOps({
        ok: false,
        blocked: true,
        blockMessage: q.notes.join('；'),
        notes: q.notes,
        packageDir,
        items,
        manifest: input.manifest,
        writtenRel: [],
      }) as PackageSourceResult;
    }
  }

  // 2) SQL dumps
  const sql = await packageSqlDumps({
    host: input.host,
    dataDir,
    packageDir,
    manifest: input.manifest,
    resolvePassword: input.resolveSqlPassword,
  });
  items.push(...sql.items);
  for (const it of sql.items) {
    appendMigrateStep(dataDir, input.job, {
      phase: 'package',
      name: `sql:${it.name}`,
      result: {
        ok: it.ok,
        blocked: it.blocked,
        apply_status: it.blocked ? 'blocked' : it.ok ? 'written' : 'failed',
        notes: it.notes,
        written: it.path ? [it.path] : undefined,
      },
    });
    if (it.path) {
      writtenRel.push(relative(dataDir, it.path).replace(/\\/g, '/'));
    }
  }

  // 3) Redis
  const red = await packageRedisDumps({
    host: input.host,
    dataDir,
    packageDir,
    manifest: input.manifest,
    resolveRedis: input.resolveRedis,
  });
  items.push(...red.items);
  for (const it of red.items) {
    appendMigrateStep(dataDir, input.job, {
      phase: 'package',
      name: `redis:${it.name}`,
      result: {
        ok: it.ok,
        blocked: it.blocked,
        apply_status: it.blocked ? 'blocked' : it.ok ? 'written' : 'failed',
        notes: it.notes,
        written: it.path ? [it.path] : undefined,
      },
    });
    if (it.path) {
      writtenRel.push(relative(dataDir, it.path).replace(/\\/g, '/'));
    }
  }

  // 4) Update manifest
  let nextManifest: HostManifest = {
    ...input.manifest,
    databases: sql.databases,
    redis: red.redis,
  };
  nextManifest = refreshPackageFingerprints(dataDir, nextManifest, packageDir);

  const packageMeta = {
    jobId,
    at: new Date().toISOString(),
    databases: sql.databases,
    redis: red.redis,
    items: items.map((i) => ({
      kind: i.kind,
      name: i.name,
      ok: i.ok,
      path: i.path,
    })),
  };
  const metaPath = join(packageDir, 'package.json');
  atomicWriteJson(metaPath, packageMeta);
  writtenRel.push(relative(dataDir, metaPath).replace(/\\/g, '/'));

  // Persist under job dir too
  const jobPkg = join(migrateJobDir(dataDir, jobId), 'package.json');
  mkdirSync(migrateJobDir(dataDir, jobId), { recursive: true });
  atomicWriteJson(jobPkg, packageMeta);
  attachManifest(dataDir, input.job, nextManifest);

  const dumpFailed = !sql.ok || !red.ok;
  const blocked = sql.blocked || red.blocked;

  if (dumpFailed) {
    setMigratePhase(
      dataDir,
      input.job,
      'failed',
      tl('notes.auto.n0360'),
    );
    return assertHonestOps({
      ok: false,
      blocked: blocked || undefined,
      apply_status: blocked ? 'blocked' : 'failed',
      blockMessage: blocked
        ? tl('notes.auto.n0842')
        : tl('notes.auto.n0946'),
      notes: [
        tl('notes.auto.n0361'),
        ...items.filter((i) => !i.ok).flatMap((i) => i.notes),
      ],
      packageDir,
      items,
      manifest: nextManifest,
      writtenRel,
    }) as PackageSourceResult;
  }

  appendMigrateStep(dataDir, input.job, {
    phase: 'package',
    name: 'fingerprints',
    result: {
      ok: true,
      apply_status: 'written',
      notes: [
        `fingerprints.package-dumps=${nextManifest.fingerprints['package-dumps']?.slice(0, 12)}…`,
        `sql=${sql.databases.filter((d) => d.dumpRelPath).length} redis=${red.redis.filter((r) => r.rdbRelPath).length}`,
      ],
    },
  });

  // Mark package settings for audit
  try {
    input.db.snapshot.settings = input.db.snapshot.settings ?? {};
    input.db.snapshot.settings.migrate_last_package_job = jobId;
    input.db.snapshot.settings.migrate_last_package_at = new Date().toISOString();
    input.db.persist();
  } catch {
    /* */
  }

  return assertHonestOps({
    ok: true,
    apply_status: 'written',
    notes: [
      tl('notes.auto.t0606', { v0: (packageDir) }),
      `SQL ${sql.databases.filter((d) => d.dumpRelPath).length} · Redis ${red.redis.filter((r) => r.rdbRelPath).length}`,
      tl('notes.auto.n0277'),
    ],
    written: writtenRel.map((r) => join(dataDir, r)),
    packageDir,
    items,
    manifest: nextManifest,
    writtenRel,
  }) as PackageSourceResult;
}
