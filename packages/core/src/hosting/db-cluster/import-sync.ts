/**
 * Import cluster snapshot from fleet sync payload (edge control plane).
 */

import type { JsonStore } from '../../db/store.js';
import { planAndMaterializeDbCluster } from './plan.js';
import { getDbCluster, listDbClusters } from './store.js';
import type { DbCluster } from './types.js';

function saveAll(db: JsonStore, rows: DbCluster[]): void {
  db.snapshot.settings['db_clusters'] = JSON.stringify(rows.slice(0, 20));
  db.persist();
}

/**
 * Upsert cluster row by id from control-plane sync, then materialize plan.
 */
export function importDbClusterSync(input: {
  db: JsonStore;
  dataDir: string;
  cluster: DbCluster;
}): { ok: boolean; cluster: DbCluster; notes: string[] } {
  const notes: string[] = [];
  const incoming = input.cluster;
  if (!incoming?.id || !incoming.kind || !incoming.engine) {
    return { ok: false, cluster: incoming, notes: ['invalid cluster snapshot'] };
  }

  // strip secrets
  const params = { ...(incoming.params || {}) };
  delete params.replPassword;
  delete params.__password;

  const all = listDbClusters(input.db);
  const idx = all.findIndex((c) => c.id === incoming.id);
  const now = new Date().toISOString();
  const row: DbCluster = {
    ...incoming,
    params,
    notes: [`imported sync @ ${now}`],
    updatedAt: now,
    createdAt: incoming.createdAt || now,
  };

  if (idx >= 0) {
    all[idx] = { ...all[idx], ...row, members: row.members };
  } else {
    all.unshift(row);
  }
  saveAll(input.db, all);
  notes.push(`registry upsert ${row.id.slice(0, 8)}…`);

  try {
    const { cluster, plan } = planAndMaterializeDbCluster({
      db: input.db,
      dataDir: input.dataDir,
      clusterId: row.id,
      writeArtifacts: true,
    });
    notes.push(...(plan.notes || []).slice(0, 5));
    notes.push(plan.ok ? 'plan materialised' : 'plan incomplete');
    return { ok: plan.ok, cluster, notes };
  } catch (e) {
    notes.push(e instanceof Error ? e.message : String(e));
    return { ok: false, cluster: getDbCluster(input.db, row.id), notes };
  }
}
