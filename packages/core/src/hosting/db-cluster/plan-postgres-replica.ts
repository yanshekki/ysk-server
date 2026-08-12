import { tl } from 'ysk-server-shared';
/**
 * PostgreSQL streaming primary → replica plan (pure).
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

function replUser(c: DbCluster): string {
  return String(c.params.replUser || 'ysk_repl').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
}

export function renderPostgresPrimaryConf(c: DbCluster): string {
  return `# YSK Server managed — PostgreSQL primary (streaming)
# cluster: ${c.id} (${c.name})
# Append or place under conf.d / postgresql.conf include

# wal_level = replica
# max_wal_senders = 10
# max_replication_slots = 10
# hot_standby = on
# listen_addresses = '*'

wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
hot_standby = on
listen_addresses = '*'
`;
}

export function renderPostgresReplicaConf(c: DbCluster, m: DbClusterMember): string {
  const p = primary(c);
  const user = replUser(c);
  const host = p?.host ?? 'PRIMARY_HOST';
  const port = p?.port ?? 5432;
  return `# YSK Server managed — PostgreSQL replica
# this=${m.host} · primary=${host}
# After base backup: create standby.signal and set primary_conninfo

# In postgresql.conf (or auto.conf):
hot_standby = on
primary_conninfo = 'host=${host} port=${port} user=${user} password=CHANGE_ME application_name=${m.label || m.host}'
# primary_slot_name = 'ysk_${m.host.replace(/[^a-z0-9_]/gi, '_').slice(0, 40)}'
`;
}

export function renderPostgresPlanMd(c: DbCluster): string {
  const p = primary(c);
  const user = replUser(c);
  return [
    `# PostgreSQL streaming plan — ${c.name}`,
    ``,
    `- id: \`${c.id}\``,
    `- primary: ${p?.host ?? '—'}`,
    `- replicas: ${replicas(c).map((m) => m.host).join(', ') || '—'}`,
    `- repl user: \`${user}\``,
    ``,
    `## Order`,
    `1. Install postgresql on all nodes`,
    `2. Primary: apply conf (wal_level=replica) → restart`,
    `3. Primary: CREATE ROLE ${user} REPLICATION LOGIN PASSWORD '…'`,
    `4. pg_hba: host replication ${user} <replica-net> scram-sha-256`,
    `5. Replica: stop postgres; rm data; pg_basebackup -h primary -U ${user} -D $PGDATA -Fp -Xs -P -R`,
    `6. Start replica; probe: pg_is_in_recovery()`,
    ``,
    `## Honesty`,
    `- Plan ≠ replication running`,
    `- Password only in scripts as CHANGE_ME`,
    ``,
  ].join('\n');
}

export function renderPostgresPrimarySql(c: DbCluster): string {
  const user = replUser(c);
  return `-- Run on PRIMARY
CREATE ROLE ${user} WITH REPLICATION LOGIN PASSWORD 'CHANGE_ME';
-- pg_hba.conf example:
-- host replication ${user} 10.0.0.0/8 scram-sha-256
SELECT pg_reload_conf();
`;
}

export function renderPostgresBasebackupSh(c: DbCluster): string {
  const p = primary(c);
  const user = replUser(c);
  return `#!/usr/bin/env bash
# Run on REPLICA as postgres (review first)
set -euo pipefail
PRIMARY="${p?.host ?? 'PRIMARY'}"
USER="${user}"
PGDATA="\${PGDATA:-/var/lib/postgresql/16/main}"
systemctl stop postgresql || true
rm -rf "\$PGDATA"/*
pg_basebackup -h "\$PRIMARY" -U "\$USER" -D "\$PGDATA" -Fp -Xs -P -R
systemctl start postgresql
psql -c "SELECT pg_is_in_recovery();"
`;
}

export function planPostgresReplica(c: DbCluster): ClusterPlan {
  if (c.engine !== 'postgres' || c.kind !== 'postgres-replica') {
    return {
      ok: false,
      dryRun: true,
      clusterId: c.id,
      kind: c.kind,
      engine: c.engine,
      steps: [],
      files: [],
      notes: [tl('notes.auto.n0571')],
      requiresExecute: true,
      requiresRoot: true };
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
      notes: [tl('notes.auto.n1567')],
      requiresExecute: true,
      requiresRoot: true };
  }

  const notes: string[] = [tl('notes.auto.n0033'), `primary=${p.host}`];
  const steps: ClusterPlanStep[] = [];
  const files: ClusterPlan['files'] = [
    { relativePath: 'conf/99-ysk-postgres-primary.conf', body: renderPostgresPrimaryConf(c) },
    { relativePath: 'plan.md', body: renderPostgresPlanMd(c) },
    { relativePath: 'scripts/primary-repl-role.sql', body: renderPostgresPrimarySql(c) },
    { relativePath: 'scripts/replica-basebackup.sh', body: renderPostgresBasebackupSh(c) },
  ];

  steps.push({
    id: 'conf-primary',
    memberId: p.id,
    title: `Primary conf（${p.host}）`,
    kind: 'conf',
    body: renderPostgresPrimaryConf(c),
    risk: 'write-panel' });
  steps.push({
    id: 'sql-role',
    memberId: p.id,
    title: 'Primary CREATE ROLE REPLICATION',
    kind: 'manual',
    body: renderPostgresPrimarySql(c),
    risk: 'execute-host' });

  for (const m of replicas(c)) {
    const conf = renderPostgresReplicaConf(c, m);
    const safe = m.host.replace(/[^a-zA-Z0-9._-]/g, '_');
    files.push({ relativePath: `conf/peers/${safe}-replica.conf`, body: conf });
    steps.push({
      id: `conf-replica-${m.id}`,
      memberId: m.id,
      title: `Replica conf ${m.host}`,
      kind: 'conf',
      body: conf,
      risk: 'write-panel' });
    steps.push({
      id: `basebackup-${m.id}`,
      memberId: m.id,
      title: `Replica ${m.host} pg_basebackup`,
      kind: 'manual',
      body: renderPostgresBasebackupSh(c),
      risk: 'execute-host' });
  }

  steps.push({
    id: 'probe',
    title: tl('notes.auto.n0888'),
    kind: 'probe',
    risk: 'read' });

  if (!replicas(c).length) notes.push(tl('notes.auto.n0034'));

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
    requiresRoot: true };
}
