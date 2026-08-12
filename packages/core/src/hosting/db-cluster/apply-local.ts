import { tl } from 'ysk-server-shared';
/**
 * Apply local cluster conf (honest).
 * Default execute=false → dataDir artifacts only (written).
 * execute=true needs YSK_EXECUTE + root to install system drop-in.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { planAndMaterializeDbCluster } from './plan.js';
import { updateDbCluster } from './store.js';
import type { DbCluster, DbClusterMember, MemberApplyStatus } from './types.js';

const SYSTEM_GALERA_DROPINS = [
  '/etc/mysql/mariadb.conf.d/99-ysk-galera.cnf',
  '/etc/mysql/conf.d/99-ysk-galera.cnf',
];

const SYSTEM_MYSQL_DROPINS = [
  '/etc/mysql/mysql.conf.d/99-ysk-mysql-repl.cnf',
  '/etc/mysql/conf.d/99-ysk-mysql-repl.cnf',
];

export interface ClusterApplyResult {
  ok: boolean;
  dryRun: boolean;
  executed: boolean;
  blocked?: boolean;
  cluster: DbCluster;
  written: string[];
  notes: string[];
  requiresExecute: boolean;
  requiresRoot: boolean;
  /** system drop-in path if installed */
  systemConf?: string;
}

function localMember(c: DbCluster): DbClusterMember | undefined {
  return c.members.find((m) => m.access === 'local') ?? c.members[0];
}

function markLocal(
  members: DbClusterMember[],
  localId: string | undefined,
  status: MemberApplyStatus,
): DbClusterMember[] {
  return members.map((m) =>
    m.id === localId || (localId == null && m.access === 'local')
      ? { ...m, applyStatus: status }
      : m,
  );
}

/**
 * Apply local Galera (or generic) conf for this control-plane host.
 * - Always ensures plan artifacts under dataDir
 * - Without execute: status stays planned/partial, local applyStatus=written
 * - With execute + EXECUTE + root: copy drop-in to system path
 */
export async function applyDbClusterLocal(input: {
  db: JsonStore;
  dataDir: string;
  host: HostExecutor;
  clusterId: string;
  /** default false — dry-run / panel write only */
  execute?: boolean;
  /** if true and execute, attempt galera_new_cluster instead of restart (first node only) */
  bootstrap?: boolean;
}): Promise<ClusterApplyResult> {
  const want = input.execute === true;
  const notes: string[] = [];
  const written: string[] = [];

  // Ensure plan materialised
  const { cluster: planned, plan } = planAndMaterializeDbCluster({
    db: input.db,
    dataDir: input.dataDir,
    clusterId: input.clusterId,
    writeArtifacts: true,
  });
  if (!plan.ok) {
    return {
      ok: false,
      dryRun: !want,
      executed: false,
      cluster: planned,
      written,
      notes: [...plan.notes, tl('notes.auto.n1162')],
      requiresExecute: true,
      requiresRoot: true,
    };
  }

  const artifactDir =
    planned.artifactDir ?? join(input.dataDir, 'clusters', planned.id);
  const local = localMember(planned);
  const localRole = (local?.role || '').toLowerCase();
  const safeHost = (local?.host || 'node').replace(/[^a-zA-Z0-9._-]/g, '_');
  const confSrc = (() => {
    if (planned.kind === 'mariadb-galera') {
      return join(artifactDir, 'conf', '99-ysk-galera.cnf');
    }
    if (planned.kind === 'mysql-replica') {
      return localRole === 'replica' || localRole === 'slave'
        ? join(artifactDir, 'conf', 'peers', `${safeHost}-replica.cnf`)
        : join(artifactDir, 'conf', '99-ysk-mysql-primary.cnf');
    }
    if (planned.kind === 'postgres-replica') {
      return localRole === 'replica'
        ? join(artifactDir, 'conf', 'peers', `${safeHost}-replica.conf`)
        : join(artifactDir, 'conf', '99-ysk-postgres-primary.conf');
    }
    if (planned.kind === 'redis-replica' || planned.kind === 'redis-sentinel') {
      if (localRole === 'sentinel') {
        return join(artifactDir, 'conf', 'peers', `${safeHost}-sentinel.conf`);
      }
      if (localRole === 'replica') {
        return join(artifactDir, 'conf', 'peers', `${safeHost}-replica.conf`);
      }
      return join(artifactDir, 'conf', '99-ysk-redis-master.conf');
    }
    return '';
  })();
  if (confSrc && existsSync(confSrc)) {
    written.push(confSrc);
  } else if (confSrc) {
    notes.push(tl('notes.auto.t0584', { v0: (confSrc) }));
  }

  const requiresExecute = true;
  const requiresRoot = true;

  // dry-run / no execute: mark written on local member only
  if (!want) {
    const members = markLocal(planned.members, local?.id, 'written');
    const cluster = updateDbCluster(input.db, planned.id, {
      members,
      status: 'partial',
      notes: [
        ...plan.notes,
        tl('notes.auto.n0272'),
      ],
      artifactDir,
    });
    return {
      ok: true,
      dryRun: true,
      executed: false,
      cluster,
      written,
      notes: cluster.notes,
      requiresExecute,
      requiresRoot,
    };
  }

  if (!input.host.executeEnabled()) {
    const members = markLocal(planned.members, local?.id, 'written');
    const cluster = updateDbCluster(input.db, planned.id, {
      members,
      status: 'partial',
      notes: [
        tl('notes.auto.n0768'),
        ...plan.notes.slice(0, 4),
      ],
    });
    return {
      ok: false,
      dryRun: false,
      executed: false,
      blocked: true,
      cluster,
      written,
      notes: cluster.notes,
      requiresExecute: true,
      requiresRoot: !input.host.isRoot(),
    };
  }

  if (!input.host.isRoot()) {
    const members = markLocal(planned.members, local?.id, 'written');
    const cluster = updateDbCluster(input.db, planned.id, {
      members,
      status: 'partial',
      notes: [tl('notes.auto.n0769'), ...plan.notes.slice(0, 3)],
    });
    return {
      ok: false,
      dryRun: false,
      executed: false,
      blocked: true,
      cluster,
      written,
      notes: cluster.notes,
      requiresExecute: false,
      requiresRoot: true,
    };
  }

  const supported = [
    'mariadb-galera',
    'mysql-replica',
    'postgres-replica',
    'redis-replica',
    'redis-sentinel',
  ];
  if (!supported.includes(planned.kind)) {
    return {
      ok: false,
      dryRun: false,
      executed: false,
      cluster: planned,
      written,
      notes: [tl('notes.auto.t0585', { v0: (planned.kind) })],
      requiresExecute,
      requiresRoot,
    };
  }

  // Resolve conf source (fallbacks)
  let src = confSrc;
  if ((!src || !existsSync(src)) && planned.kind === 'mysql-replica') {
    const primaryPath = join(artifactDir, 'conf', '99-ysk-mysql-primary.cnf');
    if (existsSync(primaryPath)) src = primaryPath;
  }
  if ((!src || !existsSync(src)) && planned.kind === 'postgres-replica') {
    const p = join(artifactDir, 'conf', '99-ysk-postgres-primary.conf');
    if (existsSync(p)) src = p;
  }
  if ((!src || !existsSync(src)) && planned.kind.startsWith('redis')) {
    const p = join(artifactDir, 'conf', '99-ysk-redis-master.conf');
    if (existsSync(p)) src = p;
  }
  if (!src || !existsSync(src)) {
    return {
      ok: false,
      dryRun: false,
      executed: false,
      cluster: planned,
      written,
      notes: [tl('notes.auto.n1322')],
      requiresExecute,
      requiresRoot,
    };
  }

  // System drop-in destination + unit
  let dest: string;
  let unit = 'mysql';
  if (planned.kind === 'mariadb-galera') {
    dest = SYSTEM_GALERA_DROPINS[0];
    if (!existsSync(dirname(dest)) && existsSync(dirname(SYSTEM_GALERA_DROPINS[1]))) {
      dest = SYSTEM_GALERA_DROPINS[1];
    }
    unit = 'mariadb';
  } else if (planned.kind === 'mysql-replica') {
    dest = SYSTEM_MYSQL_DROPINS[0];
    if (!existsSync(dirname(dest)) && existsSync(dirname(SYSTEM_MYSQL_DROPINS[1]))) {
      dest = SYSTEM_MYSQL_DROPINS[1];
    }
    unit = 'mysql';
  } else if (planned.kind === 'postgres-replica') {
    dest = '/etc/postgresql/ysk-repl.conf';
    // Prefer conf.d under common versions
    for (const v of ['16', '15', '14', '13']) {
      const d = `/etc/postgresql/${v}/main/conf.d`;
      if (existsSync(d)) {
        dest = `${d}/99-ysk-repl.conf`;
        break;
      }
    }
    unit = 'postgresql';
  } else {
    // redis
    dest =
      localRole === 'sentinel'
        ? '/etc/redis/sentinel-ysk.conf'
        : '/etc/redis/redis-ysk-repl.conf';
    unit = localRole === 'sentinel' ? 'redis-sentinel' : 'redis-server';
  }

  try {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    written.push(dest);
    notes.push(tl('notes.auto.t0586', { v0: (dest) }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const members = markLocal(planned.members, local?.id, 'failed');
    const cluster = updateDbCluster(input.db, planned.id, {
      members,
      status: 'failed',
      notes: [tl('notes.auto.t0587', { v0: (msg) })],
    });
    return {
      ok: false,
      dryRun: false,
      executed: false,
      cluster,
      written,
      notes: cluster.notes,
      requiresExecute,
      requiresRoot,
    };
  }

  // Lifecycle
  let cmdOk = true;
  if (planned.kind === 'mariadb-galera' && input.bootstrap) {
    const { resolveBin } = await import('../software-probe/index.js');
    const galeraBin = await resolveBin(input.host, 'galera_new_cluster');
    if (galeraBin) {
      const r = await input.host.runCommand([galeraBin], {
        timeoutMs: 120_000,
      });
      cmdOk = r.exitCode === 0;
      notes.push(
        cmdOk
          ? tl('notes.auto.n0724')
          : tl('notes.auto.t0588', { v0: ((r.stderr || r.stdout || '').slice(0, 200)) }),
      );
    } else {
      const r = await input.host.runCommand(['systemctl', 'restart', unit], {
        timeoutMs: 120_000,
      });
      cmdOk = r.exitCode === 0;
      notes.push(
        tl('notes.auto.n1077'),
        cmdOk ? 'restart OK' : tl('notes.tpl.restartFailed2', { detail: (r.stderr || r.stdout || '').slice(0, 160) }),
      );
    }
  } else {
    const r = await input.host.runCommand(['systemctl', 'restart', unit], {
      timeoutMs: 120_000,
    });
    cmdOk = r.exitCode === 0;
    if (
      planned.kind === 'mysql-replica' ||
      planned.kind === 'postgres-replica' ||
      planned.kind.startsWith('redis')
    ) {
      notes.push(
        cmdOk
          ? tl('notes.auto.t0589', { v0: (unit) })
          : tl('notes.tpl.restartFailed2', { detail: (r.stderr || r.stdout || '').slice(0, 200) }),
      );
    } else {
      notes.push(
        cmdOk
          ? tl('notes.auto.t0590', { v0: (unit) })
          : tl('notes.tpl.restartFailed2', { detail: (r.stderr || r.stdout || '').slice(0, 200) }),
      );
    }
  }

  const members = markLocal(
    planned.members,
    local?.id,
    cmdOk ? 'applied' : 'failed',
  );
  const cluster = updateDbCluster(input.db, planned.id, {
    members,
    status: cmdOk ? 'partial' : 'failed',
    notes: [
      ...notes,
      tl('notes.auto.n0221'),
      tl('notes.auto.n0373'),
    ],
    artifactDir,
  });

  // Mirror status into artifact cluster.json
  try {
    writeFileSync(
      join(artifactDir, 'cluster.json'),
      JSON.stringify(cluster, null, 2) + '\n',
      'utf8',
    );
  } catch {
    /* ignore */
  }

  return {
    ok: cmdOk,
    dryRun: false,
    executed: true,
    cluster,
    written,
    notes: cluster.notes,
    requiresExecute: false,
    requiresRoot: false,
    systemConf: dest,
  };
}

/** Read managed conf snippet for display (no secrets). */
export function readLocalGaleraConfSnippet(dataDir: string, clusterId: string, max = 2000): string {
  const p = join(dataDir, 'clusters', clusterId, 'conf', '99-ysk-galera.cnf');
  if (!existsSync(p)) return '';
  try {
    return readFileSync(p, 'utf8').slice(0, max);
  } catch {
    return '';
  }
}
