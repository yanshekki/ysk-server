/**
 * Redis replica (+ optional Sentinel plan) — pure planners.
 */

import type { ClusterPlan, ClusterPlanStep, DbCluster, DbClusterMember } from './types.js';

function master(c: DbCluster): DbClusterMember | undefined {
  return (
    c.members.find((m) => m.role === 'master' || m.role === 'primary') ??
    c.members.find((m) => m.access === 'local') ??
    c.members[0]
  );
}

function replicas(c: DbCluster): DbClusterMember[] {
  const m = master(c);
  return c.members.filter((x) => x.id !== m?.id && x.role !== 'sentinel');
}

function sentinels(c: DbCluster): DbClusterMember[] {
  return c.members.filter((m) => m.role === 'sentinel');
}

export function renderRedisMasterConf(c: DbCluster): string {
  const port = Number(c.params.port) || 6379;
  return `# YSK Server managed — Redis master
# cluster: ${c.id} (${c.name})

bind 0.0.0.0
port ${port}
protected-mode yes
# requirepass CHANGE_ME
# masterauth CHANGE_ME
appendonly yes
`;
}

export function renderRedisReplicaConf(c: DbCluster, m: DbClusterMember): string {
  const mast = master(c);
  const port = Number(c.params.port) || 6379;
  const mhost = mast?.host ?? 'MASTER_HOST';
  const mport = mast?.port ?? port;
  return `# YSK Server managed — Redis replica
# this=${m.host} · master=${mhost}

bind 0.0.0.0
port ${port}
replicaof ${mhost} ${mport}
# masterauth CHANGE_ME
# requirepass CHANGE_ME
appendonly yes
`;
}

export function renderRedisSentinelConf(c: DbCluster, m: DbClusterMember): string {
  const mast = master(c);
  const name = String(c.params.sentinelName || c.name || 'ysk-redis').replace(
    /[^a-zA-Z0-9_-]/g,
    '-',
  );
  const mhost = mast?.host ?? 'MASTER_HOST';
  const mport = mast?.port ?? 6379;
  const quorum = Number(c.params.quorum) || Math.max(1, Math.floor(sentinels(c).length / 2) + 1);
  return `# YSK Server managed — Redis Sentinel
# this=${m.host}

port ${m.port || 26379}
sentinel monitor ${name} ${mhost} ${mport} ${quorum}
sentinel down-after-milliseconds ${name} 5000
sentinel failover-timeout ${name} 60000
# sentinel auth-pass ${name} CHANGE_ME
`;
}

export function renderRedisPlanMd(c: DbCluster): string {
  const m = master(c);
  return [
    `# Redis ${c.kind} plan — ${c.name}`,
    ``,
    `- id: \`${c.id}\``,
    `- master: ${m?.host ?? '—'}`,
    `- replicas: ${replicas(c).map((x) => x.host).join(', ') || '—'}`,
    c.kind === 'redis-sentinel'
      ? `- sentinels: ${sentinels(c).map((x) => x.host).join(', ') || '—'}`
      : '',
    ``,
    `## Order`,
    `1. Install redis-server on all nodes`,
    `2. Master: apply conf → systemctl restart redis-server`,
    `3. Replica: apply replicaof conf → restart`,
    `4. Probe: INFO replication`,
    c.kind === 'redis-sentinel'
      ? `5. Sentinel nodes: install sentinel conf → redis-sentinel / systemctl`
      : '',
    ``,
    `## Honesty`,
    `- Plan ≠ replication linked`,
    `- Passwords only as CHANGE_ME placeholders`,
    ``,
  ]
    .filter(Boolean)
    .join('\n');
}

export function planRedisReplica(c: DbCluster): ClusterPlan {
  if (c.engine !== 'redis' || (c.kind !== 'redis-replica' && c.kind !== 'redis-sentinel')) {
    return {
      ok: false,
      dryRun: true,
      clusterId: c.id,
      kind: c.kind,
      engine: c.engine,
      steps: [],
      files: [],
      notes: ['僅支援 redis + redis-replica|redis-sentinel'],
      requiresExecute: true,
      requiresRoot: true,
    };
  }

  const m = master(c);
  if (!m) {
    return {
      ok: false,
      dryRun: true,
      clusterId: c.id,
      kind: c.kind,
      engine: c.engine,
      steps: [],
      files: [],
      notes: ['需要 master 節點'],
      requiresExecute: true,
      requiresRoot: true,
    };
  }

  const notes: string[] = ['dry-run：未改系統', `master=${m.host}`];
  const steps: ClusterPlanStep[] = [];
  const files: ClusterPlan['files'] = [
    { relativePath: 'conf/99-ysk-redis-master.conf', body: renderRedisMasterConf(c) },
    { relativePath: 'plan.md', body: renderRedisPlanMd(c) },
  ];

  steps.push({
    id: 'conf-master',
    memberId: m.id,
    title: `Master conf（${m.host}）`,
    kind: 'conf',
    body: renderRedisMasterConf(c),
    risk: 'write-panel',
  });

  for (const r of replicas(c)) {
    const conf = renderRedisReplicaConf(c, r);
    const safe = r.host.replace(/[^a-zA-Z0-9._-]/g, '_');
    files.push({ relativePath: `conf/peers/${safe}-replica.conf`, body: conf });
    steps.push({
      id: `conf-replica-${r.id}`,
      memberId: r.id,
      title: `Replica conf ${r.host}`,
      kind: 'conf',
      body: conf,
      risk: 'write-panel',
    });
  }

  if (c.kind === 'redis-sentinel') {
    if (!sentinels(c).length) {
      notes.push('sentinel 模式但未登記 sentinel 角色成員');
    }
    for (const s of sentinels(c)) {
      const conf = renderRedisSentinelConf(c, s);
      const safe = s.host.replace(/[^a-zA-Z0-9._-]/g, '_');
      files.push({ relativePath: `conf/peers/${safe}-sentinel.conf`, body: conf });
      steps.push({
        id: `conf-sentinel-${s.id}`,
        memberId: s.id,
        title: `Sentinel conf ${s.host}`,
        kind: 'conf',
        body: conf,
        risk: 'write-panel',
      });
    }
  }

  steps.push({
    id: 'probe',
    title: '探測 INFO replication',
    kind: 'probe',
    risk: 'read',
  });

  if (!replicas(c).length) notes.push('建議至少 1 個 replica');

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
