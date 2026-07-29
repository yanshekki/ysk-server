/**
 * Dispatch cluster ops to fleet agents (access=fleet members).
 * Enqueues { cli: [...] } — edge runs ysk-server with --json.
 */

import { ErrorCodes, YskError } from '@ysk/shared';
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
    cli: string[];
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

/**
 * Build CLI argv for a peer apply hint (edge runs full apply on that host's dataDir).
 * Edge should already have cluster registry synced or re-create — we pass plan artifact ops.
 */
export function buildFleetCliForMember(
  cluster: DbCluster,
  _member: DbClusterMember,
  op: 'apply' | 'probe' | 'plan',
): string[] {
  if (op === 'probe') {
    return ['db-cluster', 'probe', '--id', cluster.id, '--json'];
  }
  if (op === 'plan') {
    return ['db-cluster', 'plan', '--id', cluster.id, '--json'];
  }
  // apply dry-run on edge by default; operator can re-queue with execute via custom CLI
  return ['db-cluster', 'apply', '--id', cluster.id, '--json'];
}

/**
 * Queue fleet commands. execute=false → dry-run list only.
 * execute=true → enqueue via FleetService.enqueue (session id = fleetAgentId).
 *
 * Note: cluster id must exist on edge dataDir for probe/apply to work there.
 * PR6 documents this; optional future: ship create payload in cli args.
 */
export function dispatchDbClusterFleet(input: {
  db: JsonStore;
  clusterId: string;
  op?: 'apply' | 'probe' | 'plan';
  memberId?: string;
  /** when true, actually enqueue; else plan only */
  execute?: boolean;
  /** required when execute=true */
  enqueue?: FleetEnqueueFn;
  /** pass --execute to edge apply */
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
        '無 access=fleet 且填了 fleetAgentId 的成員',
        '建立時例如：--member 10.0.0.3=replica:fleet --fleet-agent SESSION_UUID',
      ],
    };
  }

  for (const m of members) {
    let cli = buildFleetCliForMember(cluster, m, op);
    if (op === 'apply' && input.edgeExecute) {
      cli = ['db-cluster', 'apply', '--id', cluster.id, '--execute', '--json'];
    }
    queued.push({
      memberId: m.id,
      host: m.host,
      fleetAgentId: m.fleetAgentId!,
      cli,
    });
  }

  if (!input.execute) {
    notes.push(
      'dry-run fleet dispatch（未入佇列）',
      `${queued.length} 個 agent 目標`,
      'execute 後會 enqueue { cli: [...] }；edge 需同一 cluster id 或先 create',
    );
    for (const q of queued) {
      notes.push(`${q.host} → agent ${q.fleetAgentId.slice(0, 8)}… ${q.cli.join(' ')}`);
    }
    return { ok: true, dryRun: true, cluster, queued, notes };
  }

  if (!input.enqueue) {
    throw new YskError(ErrorCodes.VALIDATION, 'execute 需要 enqueue 回調', {
      httpStatus: 400,
    });
  }

  let anyFail = false;
  for (const q of queued) {
    try {
      const cmd = input.enqueue(q.fleetAgentId, { cli: q.cli });
      q.commandId = cmd.id;
      notes.push(`queued ${q.host} → cmd ${cmd.id.slice(0, 8)}…`);
    } catch (e) {
      anyFail = true;
      notes.push(
        `${q.host}: enqueue 失敗 ${e instanceof Error ? e.message : String(e)}`,
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
      'queued ≠ edge 已執行 — 睇 Agents 指令紀錄 exit/JSON',
    ],
  };
}
