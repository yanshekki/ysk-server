import { tl } from '@ysk/shared';
/**
 * Route cluster planning by kind; write artifacts under dataDir (optional).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { JsonStore } from '../../db/store.js';
import { planMariadbGalera } from './plan-mariadb-galera.js';
import { planMysqlReplica } from './plan-mysql-replica.js';
import { planPostgresReplica } from './plan-postgres-replica.js';
import { planRedisReplica } from './plan-redis-replica.js';
import { getDbCluster, updateDbCluster } from './store.js';
import type { ClusterPlan, DbCluster } from './types.js';

export function planDbCluster(cluster: DbCluster): ClusterPlan {
  if (cluster.kind === 'mariadb-galera') {
    return planMariadbGalera(cluster);
  }
  if (cluster.kind === 'mysql-replica') {
    return planMysqlReplica(cluster);
  }
  if (cluster.kind === 'postgres-replica') {
    return planPostgresReplica(cluster);
  }
  if (cluster.kind === 'redis-replica' || cluster.kind === 'redis-sentinel') {
    return planRedisReplica(cluster);
  }
  return {
    ok: false,
    dryRun: true,
    clusterId: cluster.id,
    kind: cluster.kind,
    engine: cluster.engine,
    steps: [],
    files: [],
    notes: [tl('notes.auto.t0580', { v0: (cluster.kind) })],
    requiresExecute: true,
    requiresRoot: true,
  };
}

/** Plan + mark status planned; optionally persist files under dataDir/clusters/{id}/ */
export function planAndMaterializeDbCluster(input: {
  db: JsonStore;
  dataDir: string;
  clusterId: string;
  /** write files to dataDir (default true) */
  writeArtifacts?: boolean;
}): { cluster: DbCluster; plan: ClusterPlan } {
  const cluster = getDbCluster(input.db, input.clusterId);
  const plan = planDbCluster(cluster);
  const artifactDir = join(input.dataDir, 'clusters', cluster.id);

  if (input.writeArtifacts !== false && plan.ok) {
    for (const f of plan.files) {
      const path = join(artifactDir, f.relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, f.body, 'utf8');
    }
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, 'cluster.json'),
      JSON.stringify({ ...cluster, status: 'planned' }, null, 2) + '\n',
      'utf8',
    );
  }

  const next = updateDbCluster(input.db, cluster.id, {
    status: plan.ok ? 'planned' : cluster.status,
    artifactDir: plan.ok ? artifactDir : cluster.artifactDir,
    notes: plan.notes,
  });

  return { cluster: next, plan };
}
