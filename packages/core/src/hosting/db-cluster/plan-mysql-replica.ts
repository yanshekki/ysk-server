/**
 * MySQL async primary → replica plan (pure; never mutates host).
 */

import type { ClusterPlan, ClusterPlanStep, DbCluster, DbClusterMember } from './types.js';

function primary(c: DbCluster): DbClusterMember | undefined {
  return (
    c.members.find((m) => m.role === 'primary' || m.role === 'master') ??
    c.members.find((m) => m.access === 'local') ??
    c.members[0]
  );
}

function replicas(c: DbCluster): DbClusterMember[] {
  const p = primary(c);
  return c.members.filter((m) => m.id !== p?.id);
}

function serverIdFor(c: DbCluster, index: number): number {
  const base = Number(c.params.serverIdBase) || 100;
  return base + index;
}

function replUser(c: DbCluster): string {
  return String(c.params.replUser || 'ysk_repl').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
}

/** Primary mysqld drop-in */
export function renderMysqlPrimaryCnf(c: DbCluster, _m: DbClusterMember, index: number): string {
  const sid = serverIdFor(c, index);
  return `# YSK Server managed — MySQL primary (async replication)
# cluster: ${c.id} (${c.name})
# written ≠ replica healthy until CHANGE REPLICATION + probe ok

[mysqld]
server-id=${sid}
log_bin=mysql-bin
binlog_format=ROW
gtid_mode=ON
enforce_gtid_consistency=ON
bind-address=0.0.0.0
# Optional: binlog_expire_logs_seconds=604800
`;
}

/** Replica mysqld drop-in */
export function renderMysqlReplicaCnf(c: DbCluster, m: DbClusterMember, index: number): string {
  const sid = serverIdFor(c, index);
  const p = primary(c);
  return `# YSK Server managed — MySQL replica
# cluster: ${c.id} · this=${m.host} · primary=${p?.host ?? '?'}
# After conf: CHANGE REPLICATION SOURCE / START REPLICA (see scripts)

[mysqld]
server-id=${sid}
report_host=${m.host}
log_bin=mysql-bin
binlog_format=ROW
gtid_mode=ON
enforce_gtid_consistency=ON
read_only=ON
super_read_only=ON
relay_log=relay-bin
# skip_replica_start=ON  # uncomment until CHANGE REPLICATION done
`;
}

export function renderMysqlReplicaPlanMd(c: DbCluster): string {
  const p = primary(c);
  const user = replUser(c);
  const reps = replicas(c);
  return [
    `# MySQL primary→replica plan — ${c.name}`,
    ``,
    `- id: \`${c.id}\``,
    `- primary: ${p?.host ?? '—'} (${p?.access ?? ''})`,
    `- replicas: ${reps.map((m) => m.host).join(', ') || '—'}`,
    `- repl user: \`${user}\` (set password once; not stored in conf)`,
    ``,
    `## Order`,
    `1. Install mysql-server on all nodes`,
    `2. Apply **primary** conf drop-in → restart mysql`,
    `3. On primary: CREATE USER + GRANT REPLICATION SLAVE`,
    `4. Snapshot / clone data to replica (mysqldump --all-databases or clone plugin)`,
    `5. Apply **replica** conf → restart`,
    `6. On replica: CHANGE REPLICATION SOURCE TO ...; START REPLICA;`,
    `7. Probe: SHOW MASTER STATUS / SHOW REPLICA STATUS`,
    ``,
    `## Honesty`,
    `- Plan success ≠ replication running`,
    `- Password never written into managed conf files`,
    `- Peer apply is manual / SSH / fleet (later)`,
    ``,
  ].join('\n');
}

export function renderMysqlChangeReplicationSql(c: DbCluster): string {
  const p = primary(c);
  const user = replUser(c);
  const host = p?.host ?? 'PRIMARY_HOST';
  const port = p?.port ?? 3306;
  return `-- Run on REPLICA after data clone. Replace PASSWORD.
-- MySQL 8.0.23+ syntax:

CHANGE REPLICATION SOURCE TO
  SOURCE_HOST='${host}',
  SOURCE_PORT=${port},
  SOURCE_USER='${user}',
  SOURCE_PASSWORD='CHANGE_ME',
  SOURCE_AUTO_POSITION=1;

START REPLICA;
SHOW REPLICA STATUS\\G

-- Older MySQL:
-- CHANGE MASTER TO MASTER_HOST='${host}', MASTER_PORT=${port},
--   MASTER_USER='${user}', MASTER_PASSWORD='CHANGE_ME', MASTER_AUTO_POSITION=1;
-- START SLAVE;
`;
}

export function renderMysqlPrimaryGrantsSql(c: DbCluster): string {
  const user = replUser(c);
  return `-- Run on PRIMARY (replace PASSWORD; restrict host to replica net)
CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY 'CHANGE_ME';
GRANT REPLICATION SLAVE ON *.* TO '${user}'@'%';
FLUSH PRIVILEGES;
-- Prefer: '${user}'@'10.%' or exact replica IP instead of '%'
`;
}

export function planMysqlReplica(c: DbCluster): ClusterPlan {
  const notes: string[] = [];
  const steps: ClusterPlanStep[] = [];
  const files: ClusterPlan['files'] = [];

  if (c.engine !== 'mysql' || c.kind !== 'mysql-replica') {
    return {
      ok: false,
      dryRun: true,
      clusterId: c.id,
      kind: c.kind,
      engine: c.engine,
      steps: [],
      files: [],
      notes: ['此 planner 僅支援 mysql + mysql-replica'],
      requiresExecute: true,
      requiresRoot: true,
    };
  }

  const p = primary(c);
  if (!p) {
    return {
      ok: false,
      dryRun: true,
      clusterId: c.id,
      kind: c.kind,
      engine: c.engine,
      steps: [],
      files: [],
      notes: ['需要至少一個 primary 節點'],
      requiresExecute: true,
      requiresRoot: true,
    };
  }

  if (replicas(c).length < 1) {
    notes.push('建議至少 1 個 replica；而家計劃仍可產生 primary conf');
  }

  const primaryCnf = renderMysqlPrimaryCnf(c, p, 0);
  files.push({ relativePath: 'conf/99-ysk-mysql-primary.cnf', body: primaryCnf });
  files.push({ relativePath: 'plan.md', body: renderMysqlReplicaPlanMd(c) });
  files.push({
    relativePath: 'scripts/primary-grants.sql',
    body: renderMysqlPrimaryGrantsSql(c),
  });
  files.push({
    relativePath: 'scripts/replica-change-source.sql',
    body: renderMysqlChangeReplicationSql(c),
  });

  steps.push({
    id: 'conf-primary',
    memberId: p.id,
    title: `Primary conf（${p.host}）`,
    kind: 'conf',
    body: primaryCnf,
    risk: 'write-panel',
  });
  steps.push({
    id: 'sql-grants',
    memberId: p.id,
    title: 'Primary：建立 replication 用戶（SQL 腳本）',
    kind: 'manual',
    body: renderMysqlPrimaryGrantsSql(c),
    risk: 'execute-host',
  });

  replicas(c).forEach((m, i) => {
    const cnf = renderMysqlReplicaCnf(c, m, i + 1);
    const safe = m.host.replace(/[^a-zA-Z0-9._-]/g, '_');
    files.push({ relativePath: `conf/peers/${safe}-replica.cnf`, body: cnf });
    steps.push({
      id: `conf-replica-${m.id}`,
      memberId: m.id,
      title: `Replica conf ${m.host}`,
      kind: 'conf',
      body: cnf,
      risk: 'write-panel',
    });
    steps.push({
      id: `sql-replica-${m.id}`,
      memberId: m.id,
      title: `Replica ${m.host}：CHANGE REPLICATION + START`,
      kind: 'manual',
      body: renderMysqlChangeReplicationSql(c),
      risk: 'execute-host',
    });
  });

  steps.push({
    id: 'probe',
    title: '探測 SHOW MASTER / REPLICA STATUS',
    kind: 'probe',
    risk: 'read',
  });

  notes.push(
    'dry-run：此計劃未改系統',
    `primary=${p.host} · replicas=${replicas(c).map((m) => m.host).join(',') || 'none'}`,
    '密碼只出現在 SQL 腳本佔位符 CHANGE_ME',
    'GTID 模式：兩邊 conf 已開 gtid_mode=ON',
  );

  return {
    ok: true,
    dryRun: true,
    clusterId: c.id,
    kind: c.kind,
    engine: c.engine,
    steps,
    files,
    notes,
    requiresExecute: true,
    requiresRoot: true,
  };
}
