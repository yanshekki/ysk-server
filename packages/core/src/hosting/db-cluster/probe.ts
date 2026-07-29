/**
 * Probe DB cluster health (local node first). Honest — never invent healthy.
 */

import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { getDbCluster, updateDbCluster } from './store.js';
import type {
  DbCluster,
  DbClusterMember,
  DbClusterMemberProbe,
  DbClusterStatus,
} from './types.js';

export interface ClusterProbeResult {
  ok: boolean;
  cluster: DbCluster;
  facts: Record<string, string>;
  notes: string[];
  localOk: boolean;
}

/** Parse SHOW STATUS LIKE 'wsrep%' tabular output */
export function parseWsrepStatus(stdout: string): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || /^Variable_name/i.test(t)) continue;
    // Variable_name\tValue  or  | name | value |
    const pipe = t.match(/^\|\s*(\S+)\s*\|\s*(.*?)\s*\|/);
    if (pipe) {
      facts[pipe[1]] = pipe[2];
      continue;
    }
    const parts = t.split(/\s+/);
    if (parts.length >= 2 && parts[0].startsWith('wsrep_')) {
      facts[parts[0]] = parts.slice(1).join(' ');
    }
  }
  return facts;
}

export function evaluateGaleraHealth(
  facts: Record<string, string>,
  memberCount: number,
): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  const ready = (facts.wsrep_ready || '').toUpperCase();
  const connected = (facts.wsrep_connected || '').toUpperCase();
  const localState = facts.wsrep_local_state_comment || facts.wsrep_local_state || '';
  const size = Number(facts.wsrep_cluster_size || 0);

  if (!Object.keys(facts).length) {
    return { ok: false, notes: ['無 wsrep 狀態（可能未裝 Galera 或服務未開）'] };
  }

  if (ready !== 'ON' && ready !== 'YES') {
    notes.push(`wsrep_ready=${facts.wsrep_ready ?? '—'}`);
  }
  if (connected !== 'ON' && connected !== 'YES') {
    notes.push(`wsrep_connected=${facts.wsrep_connected ?? '—'}`);
  }
  if (size > 0 && size < memberCount) {
    notes.push(`cluster_size=${size} < 登記節點 ${memberCount}`);
  }
  if (localState && !/Synced/i.test(localState) && localState !== '4') {
    notes.push(`local_state=${localState}`);
  }

  const ok =
    (ready === 'ON' || ready === 'YES') &&
    (connected === 'ON' || connected === 'YES') &&
    (size <= 0 || size >= Math.min(2, memberCount) || size >= 1);

  // Stricter: if we have memberCount >= 2, require size >= 2 for healthy
  if (memberCount >= 2 && size < 2) {
    notes.push(size > 0 ? `只有 ${size} 個節點在 cluster` : 'cluster_size 未知或 0');
    return { ok: false, notes };
  }

  if (ok && notes.length === 0) {
    notes.push(`wsrep OK · size=${size || facts.wsrep_cluster_size || '?'}`);
  }
  return { ok: ok && (memberCount < 2 || size >= 2), notes };
}

async function runWsrepShow(host: HostExecutor): Promise<{
  stdout: string;
  exitCode: number;
  stderr: string;
}> {
  // Fixed argv — mysql client only
  const r = await host.runCommand(
    ['mysql', '-N', '-e', "SHOW STATUS LIKE 'wsrep%';"],
    { timeoutMs: 15_000 },
  );
  if (r.exitCode === 0 && r.stdout.trim()) {
    return { stdout: r.stdout, exitCode: 0, stderr: r.stderr };
  }
  const r2 = await host.runCommand(
    ['mariadb', '-N', '-e', "SHOW STATUS LIKE 'wsrep%';"],
    { timeoutMs: 15_000 },
  );
  return {
    stdout: r2.stdout || r.stdout,
    exitCode: r2.exitCode,
    stderr: r2.stderr || r.stderr,
  };
}

/**
 * Probe local node for Galera; update registry.
 * Peer probes via SSH are out of scope for PR2 (notes only).
 */
export async function probeDbCluster(input: {
  db: JsonStore;
  host: HostExecutor;
  clusterId: string;
}): Promise<ClusterProbeResult> {
  const cluster = getDbCluster(input.db, input.clusterId);
  const notes: string[] = [];
  const at = new Date().toISOString();

  if (cluster.kind !== 'mariadb-galera') {
    notes.push(`probe 暫只支援 mariadb-galera（${cluster.kind}）`);
    const next = updateDbCluster(input.db, cluster.id, {
      status: 'degraded',
      notes,
    });
    return { ok: false, cluster: next, facts: {}, notes, localOk: false };
  }

  const localIdx = cluster.members.findIndex((m) => m.access === 'local');
  const local =
    localIdx >= 0 ? cluster.members[localIdx] : cluster.members[0];

  const r = await runWsrepShow(input.host);
  let facts: Record<string, string> = {};
  let localOk = false;
  let localProbe: DbClusterMemberProbe;

  if (r.exitCode !== 0) {
    localProbe = {
      at,
      ok: false,
      facts: {},
      notes: [
        `mysql/mariadb 查詢失敗：${(r.stderr || r.stdout || 'exit ' + r.exitCode).slice(0, 160)}`,
      ],
    };
    notes.push(...localProbe.notes);
  } else {
    facts = parseWsrepStatus(r.stdout);
    const evaled = evaluateGaleraHealth(facts, cluster.members.length);
    localOk = evaled.ok;
    localProbe = {
      at,
      ok: localOk,
      facts,
      notes: evaled.notes,
    };
    notes.push(...evaled.notes);
  }

  const members: DbClusterMember[] = cluster.members.map((m) => {
    if (local && m.id === local.id) {
      return {
        ...m,
        lastProbe: localProbe,
      };
    }
    // Peers: no remote probe yet
    return {
      ...m,
      lastProbe: m.lastProbe ?? {
        at,
        ok: false,
        facts: {},
        notes: ['peer 未探測（PR2 只 probe 本機）'],
      },
    };
  });

  let status: DbClusterStatus = 'degraded';
  if (localOk && cluster.members.length >= 2) {
    const size = Number(facts.wsrep_cluster_size || 0);
    if (size >= cluster.members.length) status = 'healthy';
    else if (size >= 2) {
      status = 'partial';
      notes.push('本機 wsrep 尚可，但 size 未達全部登記節點');
    } else status = 'degraded';
  } else if (localOk && cluster.members.length === 1) {
    status = 'partial';
    notes.push('單節點有 wsrep，但 HA 需 ≥2 節點');
  } else if (!localOk) {
    status = cluster.members.some((m) => m.applyStatus === 'applied')
      ? 'degraded'
      : 'failed';
  }

  const next = updateDbCluster(input.db, cluster.id, {
    members,
    status,
    notes: notes.slice(0, 20),
  });

  return {
    ok: localOk && status === 'healthy',
    cluster: next,
    facts,
    notes: next.notes,
    localOk,
  };
}
