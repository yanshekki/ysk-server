/**
 * Dispatch cluster ops to fleet agents (access=fleet members).
 * Enqueues { cli: [...] } and/or { clusterSync: {...} } for edge bootstrap.
 */

import { ErrorCodes, YskError, tl} from 'ysk-server-shared';
import type { JsonStore } from '../../db/store.js';
import { getDbCluster, updateDbCluster } from './store.js';
import type { DbCluster, DbClusterMember } from './types.js';

export type FleetEnqueueFn = (
  sessionId: string,
  payload: unknown,
) => { id: string; agent_session_id: string; status: string };

export type FleetDispatchResult = {
  ok: boolean;
  dryRun: boolean;
  cluster: DbCluster;
  queued: Array<{
    memberId: string;
    host: string;
    fleetAgentId: string;
    commandId?: string;
    cli?: string[];
    payload?: unknown;
  }>;
  notes: string[];
};

function fleetMembers(c: DbCluster, memberId?: string): DbClusterMember[] {
  return c.members.filter(
    (m) =>
      m.access === 'fleet' &&
      m.fleetAgentId &&
      (!memberId || m.id === memberId),
  );
}

export function buildFleetCliForMember(
  cluster: DbCluster,
  _member: DbClusterMember,
  op: 'apply' | 'probe' | 'plan' | 'sync',
  edgeExecute?: boolean,
): string[] {
  if (op === 'probe') {
    return ['db-cluster', 'probe', '--id', cluster.id, '--json'];
  }
  if (op === 'plan' || op === 'sync') {
    return ['db-cluster', 'plan', '--id', cluster.id, '--json'];
  }
  if (edgeExecute) {
    return ['db-cluster', 'apply', '--id', cluster.id, '--execute', '--json'];
  }
  return ['db-cluster', 'apply', '--id', cluster.id, '--json'];
}

/** Snapshot safe for edge re-create (no secrets) */
export function clusterSyncPayload(cluster: DbCluster): {
  op: 'clusterSync';
  cluster: DbCluster;
  cli: string[];
} {
  const params = { ...cluster.params };
  delete params.replPassword;
  delete params.__password;
  const sanitized: DbCluster = { ...cluster, params };
  return {
    op: 'clusterSync',
    cluster: sanitized,
    // edge import-sync upserts registry then plan
    cli: ['db-cluster', 'import-sync', '--json'],
  };
}

export function dispatchDbClusterFleet(input: {
  db: JsonStore;
  clusterId: string;
  op?: 'apply' | 'probe' | 'plan' | 'sync';
  memberId?: string;
  execute?: boolean;
  enqueue?: FleetEnqueueFn;
  edgeExecute?: boolean;
}): FleetDispatchResult {
  const cluster = getDbCluster(input.db, input.clusterId);
  const op = input.op ?? 'apply';
  const members = fleetMembers(cluster, input.memberId);
  const notes: string[] = [];
  const queued: FleetDispatchResult['queued'] = [];

  if (!members.length) {
    return {
      ok: false,
      dryRun: !input.execute,
      cluster,
      queued: [],
      notes: [
        tl('notes.auto.n1068'),
        tl('notes.auto.n0553'),
      ],
    };
  }

  for (const m of members) {
    if (op === 'sync') {
      const payload = clusterSyncPayload(cluster);
      queued.push({
        memberId: m.id,
        host: m.host,
        fleetAgentId: m.fleetAgentId!,
        payload,
        cli: payload.cli,
      });
    } else {
      const cli = buildFleetCliForMember(cluster, m, op, input.edgeExecute);
      queued.push({
        memberId: m.id,
        host: m.host,
        fleetAgentId: m.fleetAgentId!,
        cli,
        payload: { cli },
      });
    }
  }

  if (!input.execute) {
    notes.push(
      tl('notes.auto.n0262'),
      tl('notes.auto.t0578', { v0: (queued.length), v1: (op) }),
    );
    for (const q of queued) {
      notes.push(
        `${q.host} → ${q.fleetAgentId.slice(0, 8)}… ${q.cli?.join(' ') ?? 'clusterSync'}`,
      );
    }
    return { ok: true, dryRun: true, cluster, queued, notes };
  }

  if (!input.enqueue) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0280'), {
      httpStatus: 400,
    });
  }

  let anyFail = false;
  for (const q of queued) {
    try {
      const cmd = input.enqueue(q.fleetAgentId, q.payload ?? { cli: q.cli });
      q.commandId = cmd.id;
      notes.push(`queued ${q.host} → cmd ${cmd.id.slice(0, 8)}…`);
    } catch (e) {
      anyFail = true;
      notes.push(
        tl('notes.auto.t0579', { v0: (q.host), v1: (e instanceof Error ? e.message : String(e)) }),
      );
    }
  }

  const next = updateDbCluster(input.db, cluster.id, {
    notes: notes.slice(0, 30),
    status: anyFail ? 'partial' : cluster.status,
  });

  return {
    ok: !anyFail,
    dryRun: false,
    cluster: next,
    queued,
    notes: [
      ...notes,
      tl('notes.auto.n0399'),
    ],
  };
}
