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
      notes: [...plan.notes, '無法套用：計劃失敗'],
      requiresExecute: true,
      requiresRoot: true,
    };
  }

  const artifactDir =
    planned.artifactDir ?? join(input.dataDir, 'clusters', planned.id);
  const confSrc = join(artifactDir, 'conf', '99-ysk-galera.cnf');
  if (planned.kind === 'mariadb-galera' && existsSync(confSrc)) {
    written.push(confSrc);
  } else if (planned.kind === 'mariadb-galera') {
    notes.push('找不到 99-ysk-galera.cnf 產物');
  }

  const local = localMember(planned);
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
        'dry-run：已寫入管理檔（dataDir）。加 execute + YSK_EXECUTE=1 + root 先裝系統 drop-in',
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
        '已寫管理檔，但未套用系統 conf：需 YSK_EXECUTE=1',
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
      notes: ['已寫管理檔，但未套用系統 conf：需要 root', ...plan.notes.slice(0, 3)],
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

  if (planned.kind !== 'mariadb-galera') {
    return {
      ok: false,
      dryRun: false,
      executed: false,
      cluster: planned,
      written,
      notes: [`本機 apply 暫只支援 mariadb-galera（而家係 ${planned.kind}）`],
      requiresExecute,
      requiresRoot,
    };
  }

  if (!existsSync(confSrc)) {
    return {
      ok: false,
      dryRun: false,
      executed: false,
      cluster: planned,
      written,
      notes: ['缺少 conf 產物，請先 plan'],
      requiresExecute,
      requiresRoot,
    };
  }

  // Prefer mariadb.conf.d if present
  let dest = SYSTEM_GALERA_DROPINS[0];
  if (!existsSync(dirname(dest)) && existsSync(dirname(SYSTEM_GALERA_DROPINS[1]))) {
    dest = SYSTEM_GALERA_DROPINS[1];
  }
  try {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(confSrc, dest);
    written.push(dest);
    notes.push(`已安裝系統 drop-in：${dest}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const members = markLocal(planned.members, local?.id, 'failed');
    const cluster = updateDbCluster(input.db, planned.id, {
      members,
      status: 'failed',
      notes: [`寫入系統 conf 失敗：${msg}`],
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

  // Lifecycle: bootstrap vs restart (fixed argv only)
  let cmdOk = true;
  if (input.bootstrap) {
    const which = await input.host.runCommand(
      ['bash', '-c', 'command -v galera_new_cluster || true'],
      { timeoutMs: 5_000 },
    );
    if (which.stdout.trim()) {
      const r = await input.host.runCommand(['galera_new_cluster'], {
        timeoutMs: 120_000,
      });
      cmdOk = r.exitCode === 0;
      notes.push(
        cmdOk
          ? '已 galera_new_cluster（bootstrap）'
          : `galera_new_cluster 失敗：${(r.stderr || r.stdout || '').slice(0, 200)}`,
      );
    } else {
      // Fallback: mysqld_safe path not used — document only
      const r = await input.host.runCommand(['systemctl', 'restart', 'mariadb'], {
        timeoutMs: 120_000,
      });
      cmdOk = r.exitCode === 0;
      notes.push(
        '無 galera_new_cluster 指令；已 restart mariadb（首節點 bootstrap 可能需人手）',
        cmdOk ? 'restart OK' : `restart 失敗：${(r.stderr || r.stdout || '').slice(0, 160)}`,
      );
    }
  } else {
    const r = await input.host.runCommand(['systemctl', 'restart', 'mariadb'], {
      timeoutMs: 120_000,
    });
    cmdOk = r.exitCode === 0;
    notes.push(
      cmdOk
        ? '已 systemctl restart mariadb（join 時用；首節點請加 bootstrap）'
        : `restart 失敗：${(r.stderr || r.stdout || '').slice(0, 200)}`,
    );
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
      'applied ≠ healthy — 請跑 probe 確認 wsrep',
      'peer 節點仍需各自套用 conf 並 join',
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
