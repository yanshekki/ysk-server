/**
 * Restore phase (runs on target host with local HostExecutor + dataDir).
 * - Ensure control plane files present
 * - Recreate OS users with preferred UID/GID
 * - Import SQL dumps from package dir
 * - Restore Redis RDB
 */

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  HostManifest,
  HostManifestDatabase,
  HostManifestProject,
  HostManifestRedis,
  MigrateJobDto,
  OpsResultDto,
} from '@ysk/shared';
import { assertHonestOps, tl} from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { importSqlDatabase } from '../db-dump.js';
import { appendMigrateStep, setMigratePhase, writeMigrateProgress } from './job-store.js';
import { migratePackageDir } from './package-source.js';

export type RestoreItem = {
  id: string;
  kind: 'control-plane' | 'os-user' | 'sql' | 'redis' | 'chown';
  ok: boolean;
  notes: string[];
  blocked?: boolean;
};

export type RestoreResult = OpsResultDto & {
  items: RestoreItem[];
};

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Ensure ysk.json + secrets master key exist after transfer.
 */
export function ensureControlPlaneFiles(dataDir: string): RestoreItem {
  const notes: string[] = [];
  const ysk = join(dataDir, 'ysk.json');
  const master = join(dataDir, 'secrets', 'ssh', '.master.key');
  let ok = true;
  if (!existsSync(ysk)) {
    ok = false;
    notes.push(tl('notes.tpl.missing', { name: ysk }));
  } else notes.push(tl('notes.auto.n0479'));
  if (!existsSync(master) && !process.env.YSK_SECRETS_KEY) {
    notes.push(tl('notes.auto.n1434'));
  } else if (existsSync(master)) {
    notes.push(tl('notes.auto.n0426'));
  }
  const config = join(dataDir, 'config.json');
  if (!existsSync(config)) {
    notes.push(tl('notes.auto.n1435'));
  }
  return {
    id: 'control-plane',
    kind: 'control-plane',
    ok,
    notes,
  };
}

/**
 * Create group+user with optional fixed UID/GID; home already rsynced (-M).
 */
export async function restoreOsUser(input: {
  host: HostExecutor;
  project: HostManifestProject;
}): Promise<RestoreItem> {
  const p = input.project;
  const id = `os-user:${p.linux_user}`;
  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    return {
      id,
      kind: 'os-user',
      ok: false,
      blocked: true,
      notes: [tl('notes.auto.n0459')],
    };
  }

  const user = p.linux_user.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!user) {
    return { id, kind: 'os-user', ok: false, notes: [tl('notes.auto.n1103')] };
  }
  const group = (p.linux_group || user).replace(/[^a-zA-Z0-9_-]/g, '') || user;
  const home = p.home_dir;
  const notes: string[] = [];

  // Ensure group
  const gidFlag =
    p.gid != null && Number.isFinite(p.gid) ? `-g ${p.gid} ` : '';
  const grp = await input.host.runCommand(
    [
      'bash',
      '-c',
      `getent group ${shellQuote(group)} >/dev/null 2>&1 || groupadd ${gidFlag}${shellQuote(group)} 2>&1; echo YSK_GRP_DONE`,
    ],
    { timeoutMs: 15_000 },
  );
  notes.push(
    grp.exitCode === 0
      ? `group ${group}`
      : `groupadd: ${(grp.stderr || grp.stdout).slice(0, 120)}`,
  );

  // Ensure user (-M: no create home; -d: home path; -s nologin)
  const uidFlag =
    p.uid != null && Number.isFinite(p.uid) ? `-u ${p.uid} ` : '';
  const usr = await input.host.runCommand(
    [
      'bash',
      '-c',
      [
        `if id ${shellQuote(user)} >/dev/null 2>&1; then echo YSK_USER_EXISTS;`,
        `else useradd -M -d ${shellQuote(home)} -s /usr/sbin/nologin -g ${shellQuote(group)} ${uidFlag}${shellQuote(user)} 2>&1 && echo YSK_USER_CREATED; fi`,
      ].join(' '),
    ],
    { timeoutMs: 20_000 },
  );
  const out = `${usr.stdout || ''}${usr.stderr || ''}`;
  const ok =
    usr.exitCode === 0 &&
    (out.includes('YSK_USER_EXISTS') || out.includes('YSK_USER_CREATED'));
  notes.push(
    ok
      ? out.includes('YSK_USER_CREATED')
        ? tl('notes.auto.t0607', { v0: (user), v1: (p.uid ?? 'auto') })
        : tl('notes.auto.t0608', { v0: (user) })
      : tl('notes.auto.t0609', { v0: (out.slice(0, 200)) }),
  );

  // Ensure ysk-web group optional
  await input.host.runCommand(
    [
      'bash',
      '-c',
      `getent group ysk-web >/dev/null 2>&1 || groupadd ysk-web 2>/dev/null || true; usermod -aG ysk-web ${shellQuote(user)} 2>/dev/null || true`,
    ],
    { timeoutMs: 10_000 },
  );

  // chown home if exists
  if (existsSync(home)) {
    const ch = await input.host.runCommand(
      [
        'bash',
        '-c',
        `chown -R ${shellQuote(user)}:${shellQuote(group)} ${shellQuote(home)} && chmod 750 ${shellQuote(home)} && echo YSK_CHOWN_OK`,
      ],
      { timeoutMs: 120_000 },
    );
    const chOk = ch.exitCode === 0 && ch.stdout.includes('YSK_CHOWN_OK');
    notes.push(chOk ? `chown ${home}` : tl('notes.auto.t0610', { v0: ((ch.stderr || ch.stdout).slice(0, 120)) }));
    return {
      id,
      kind: 'os-user',
      ok: ok && chOk,
      notes,
    };
  }
  notes.push(tl('notes.auto.t0611', { v0: (home) }));
  return { id, kind: 'os-user', ok, notes };
}

/**
 * Import one SQL dump; create empty DB first if needed (best-effort).
 */
export async function restoreSqlDatabase(input: {
  host: HostExecutor;
  dataDir: string;
  db: HostManifestDatabase;
  resolvePassword?: (db: HostManifestDatabase) => string | undefined;
}): Promise<RestoreItem> {
  const name = `${input.db.engine}:${input.db.name}`;
  if (!input.db.dumpRelPath) {
    return {
      id: `sql:${name}`,
      kind: 'sql',
      ok: false,
      notes: [tl('notes.auto.n0326')],
    };
  }
  const sqlPath = join(input.dataDir, input.db.dumpRelPath);
  if (!existsSync(sqlPath) || statSync(sqlPath).size === 0) {
    return {
      id: `sql:${name}`,
      kind: 'sql',
      ok: false,
      notes: [tl('notes.auto.t0612', { v0: (sqlPath) })],
    };
  }

  // Ensure database exists
  const dbName = input.db.name.replace(/[^a-zA-Z0-9_]/g, '');
  if (input.db.engine === 'postgres') {
    await input.host.runCommand(
      [
        'bash',
        '-c',
        `sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${dbName}'" | grep -q 1 || sudo -u postgres createdb ${dbName} 2>&1 || true`,
      ],
      { timeoutMs: 30_000 },
    );
  } else {
    const client = input.db.engine === 'mariadb' ? 'mariadb' : 'mysql';
    await input.host.runCommand(
      [
        'bash',
        '-c',
        `${client} -e ${JSON.stringify(`CREATE DATABASE IF NOT EXISTS \\\`${dbName}\\\` CHARACTER SET utf8mb4;`)} 2>&1 || true`,
      ],
      { timeoutMs: 30_000 },
    );
  }

  const r = await importSqlDatabase({
    host: input.host,
    engine: input.db.engine,
    dbName: input.db.name,
    sqlPath,
    username: input.db.username,
    password: input.resolvePassword?.(input.db),
  });
  return {
    id: `sql:${name}`,
    kind: 'sql',
    ok: r.ok,
    blocked: r.blocked,
    notes: r.notes,
  };
}

/**
 * Restore Redis RDB: stop → copy → start (best-effort paths).
 */
export async function restoreRedisInstance(input: {
  host: HostExecutor;
  dataDir: string;
  redis: HostManifestRedis;
  redisHost?: string;
  redisPort?: number;
}): Promise<RestoreItem> {
  const id = `redis:${input.redis.id}`;
  if (!input.redis.rdbRelPath) {
    return {
      id,
      kind: 'redis',
      ok: false,
      notes: [tl('notes.auto.n0327')],
    };
  }
  const rdb = join(input.dataDir, input.redis.rdbRelPath);
  if (!existsSync(rdb)) {
    return { id, kind: 'redis', ok: false, notes: [tl('notes.auto.t0613', { v0: (rdb) })] };
  }
  if (!input.host.executeEnabled()) {
    return {
      id,
      kind: 'redis',
      ok: false,
      blocked: true,
      notes: [tl('notes.auto.n0176')],
    };
  }

  const notes: string[] = [];
  // Resolve dump path via CONFIG
  const host = input.redisHost ?? '127.0.0.1';
  const port = input.redisPort ?? 6379;
  const base = `redis-cli -h ${JSON.stringify(host)} -p ${port}`;

  await input.host.runCommand(
    ['bash', '-c', 'systemctl stop redis-server 2>/dev/null || systemctl stop redis 2>/dev/null || true'],
    { timeoutMs: 30_000 },
  );
  notes.push(tl('notes.auto.n0750'));

  const cfg = await input.host.runCommand(
    [
      'bash',
      '-c',
      `${base} CONFIG GET dir 2>/dev/null; ${base} CONFIG GET dbfilename 2>/dev/null; echo ---; ls /var/lib/redis/dump.rdb 2>/dev/null || true`,
    ],
    { timeoutMs: 10_000 },
  );
  let dir = '/var/lib/redis';
  let name = 'dump.rdb';
  const lines = (cfg.stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] === 'dir') dir = lines[i + 1] || dir;
    if (lines[i] === 'dbfilename') name = lines[i + 1] || name;
  }
  const dest = join(dir, name);
  // Prefer remote mkdir via host (may need root for /var/lib/redis)
  await input.host.runCommand(
    ['bash', '-c', `mkdir -p ${JSON.stringify(dir)} 2>/dev/null || true`],
    { timeoutMs: 10_000 },
  );

  const cp = await input.host.runCommand(
    [
      'bash',
      '-c',
      `cp -a ${JSON.stringify(rdb)} ${JSON.stringify(dest)} && chown redis:redis ${JSON.stringify(dest)} 2>/dev/null || true; echo YSK_RDB_RESTORED`,
    ],
    { timeoutMs: 60_000 },
  );
  const outCp = `${cp.stdout || ''}${cp.stderr || ''}`;
  const copied =
    cp.exitCode === 0 &&
    (outCp.includes('YSK_RDB_RESTORED') || existsSync(dest));
  notes.push(
    copied
      ? tl('notes.auto.t0614', { v0: (dest) })
      : tl('notes.auto.t0615', { v0: (outCp.slice(0, 150)) }),
  );

  const start = await input.host.runCommand(
    [
      'bash',
      '-c',
      'systemctl start redis-server 2>/dev/null || systemctl start redis 2>/dev/null || redis-server --daemonize yes 2>/dev/null || true; sleep 0.5; redis-cli ping 2>/dev/null || true',
    ],
    { timeoutMs: 30_000 },
  );
  const pong = (start.stdout || '').includes('PONG');
  notes.push(pong ? 'redis PONG' : tl('notes.auto.t0616', { v0: ((start.stdout || start.stderr || '').slice(0, 80)) }));

  return {
    id,
    kind: 'redis',
    ok: copied,
    notes,
  };
}

/**
 * Full restore phase on local target.
 */
export async function restoreOnHost(input: {
  host: HostExecutor;
  dataDir: string;
  job: MigrateJobDto;
  manifest: HostManifest;
  db?: JsonStore;
  resolveSqlPassword?: (db: HostManifestDatabase) => string | undefined;
}): Promise<RestoreResult> {
  const dataDir = resolve(input.dataDir);
  const items: RestoreItem[] = [];

  if (!input.host.executeEnabled()) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      requiresExecute: true,
      blockMessage: tl('notes.auto.n0419'),
      notes: [tl('ops.blocked.needExecuteShort')],
      items: [],
    }) as RestoreResult;
  }

  setMigratePhase(dataDir, input.job, 'restore');
  writeMigrateProgress(dataDir, input.job.id, { phase: 'restore', status: 'start' });

  const cp = ensureControlPlaneFiles(dataDir);
  items.push(cp);
  appendMigrateStep(dataDir, input.job, {
    phase: 'restore',
    name: 'control-plane',
    result: {
      ok: cp.ok,
      apply_status: cp.ok ? 'written' : 'failed',
      notes: cp.notes,
    },
  });
  if (!cp.ok) {
    setMigratePhase(dataDir, input.job, 'failed', tl('notes.auto.n0241'));
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: cp.notes,
      items,
    }) as RestoreResult;
  }

  // OS users
  for (const p of input.manifest.projects) {
    writeMigrateProgress(dataDir, input.job.id, {
      phase: 'restore',
      status: 'os-user',
      user: p.linux_user,
    });
    const r = await restoreOsUser({ host: input.host, project: p });
    items.push(r);
    appendMigrateStep(dataDir, input.job, {
      phase: 'restore',
      name: r.id,
      result: {
        ok: r.ok,
        blocked: r.blocked,
        apply_status: r.blocked ? 'blocked' : r.ok ? 'applied' : 'failed',
        notes: r.notes,
      },
    });
  }

  // SQL
  for (const d of input.manifest.databases) {
    writeMigrateProgress(dataDir, input.job.id, {
      phase: 'restore',
      status: 'sql',
      db: d.name,
    });
    const r = await restoreSqlDatabase({
      host: input.host,
      dataDir,
      db: d,
      resolvePassword: input.resolveSqlPassword,
    });
    items.push(r);
    appendMigrateStep(dataDir, input.job, {
      phase: 'restore',
      name: r.id,
      result: {
        ok: r.ok,
        blocked: r.blocked,
        apply_status: r.blocked ? 'blocked' : r.ok ? 'applied' : 'failed',
        notes: r.notes,
      },
    });
  }

  // Redis
  const seenRedis = new Set<string>();
  for (const red of input.manifest.redis) {
    if (!red.rdbRelPath) {
      items.push({
        id: `redis:${red.id}`,
        kind: 'redis',
        ok: false,
        notes: [tl('notes.auto.n1083')],
      });
      continue;
    }
    if (seenRedis.has(red.rdbRelPath)) {
      items.push({
        id: `redis:${red.id}`,
        kind: 'redis',
        ok: true,
        notes: [tl('notes.auto.n0592')],
      });
      continue;
    }
    seenRedis.add(red.rdbRelPath);
    writeMigrateProgress(dataDir, input.job.id, {
      phase: 'restore',
      status: 'redis',
      id: red.id,
    });
    const r = await restoreRedisInstance({
      host: input.host,
      dataDir,
      redis: red,
    });
    items.push(r);
    appendMigrateStep(dataDir, input.job, {
      phase: 'restore',
      name: r.id,
      result: {
        ok: r.ok,
        blocked: r.blocked,
        apply_status: r.blocked ? 'blocked' : r.ok ? 'applied' : 'failed',
        notes: r.notes,
      },
    });
  }

  // package dir presence note
  const pkg = migratePackageDir(dataDir, input.job.id);
  if (!existsSync(pkg) && input.manifest.databases.length + input.manifest.redis.length > 0) {
    items.push({
      id: 'package-dir',
      kind: 'control-plane',
      ok: true,
      notes: [
        tl('notes.auto.t0617', { v0: (pkg) }),
      ],
    });
  }

  const hardFail = items.some(
    (i) =>
      !i.ok &&
      i.kind !== 'control-plane' &&
      // control-plane already handled; package-dir ok
      i.id !== 'package-dir',
  );
  // control-plane must be ok; sql/user/redis failures are hard
  const blocked = items.some((i) => i.blocked);

  if (hardFail || !cp.ok) {
    setMigratePhase(dataDir, input.job, 'failed', tl('notes.auto.n0417'));
  }

  writeMigrateProgress(dataDir, input.job.id, {
    phase: 'restore',
    status: hardFail ? 'failed' : 'done',
  });

  return assertHonestOps({
    ok: !hardFail && cp.ok && !blocked,
    blocked: blocked || undefined,
    apply_status: hardFail ? (blocked ? 'blocked' : 'failed') : 'applied',
    notes: [
      hardFail ? tl('notes.auto.n0418') : tl('notes.auto.n0416'),
      `users ${input.manifest.projects.length} · sql ${input.manifest.databases.length} · redis ${input.manifest.redis.length}`,
      ...items.filter((i) => !i.ok).flatMap((i) => i.notes),
    ],
    items,
  }) as RestoreResult;
}
