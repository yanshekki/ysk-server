import { tl } from 'ysk-server-shared';
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
    return { ok: false, notes: [tl('notes.auto.n1090')] };
  }

  if (ready !== 'ON' && ready !== 'YES') {
    notes.push(`wsrep_ready=${facts.wsrep_ready ?? '—'}`);
  }
  if (connected !== 'ON' && connected !== 'YES') {
    notes.push(`wsrep_connected=${facts.wsrep_connected ?? '—'}`);
  }
  if (size > 0 && size < memberCount) {
    notes.push(tl('notes.auto.t0560', { v0: (size), v1: (memberCount) }));
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
    notes.push(size > 0 ? tl('notes.auto.t0561', { v0: (size) }) : tl('notes.auto.n0239'));
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

/** Parse SHOW MASTER STATUS / SHOW BINARY LOG STATUS */
export function parseMasterStatus(stdout: string): Record<string, string> {
  const facts: Record<string, string> = {};
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const headers = lines[0].split(/\t/);
    const values = lines[1].split(/\t/);
    headers.forEach((h, i) => {
      if (h) facts[`master_${h}`] = values[i] ?? '';
    });
  }
  // also key: value from \G style
  for (const line of lines) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) facts[`master_${m[1]}`] = m[2];
  }
  if (facts.master_File || facts.master_file) facts.master_has_binlog = 'yes';
  return facts;
}

/** Parse SHOW REPLICA STATUS / SHOW SLAVE STATUS */
export function parseReplicaStatus(stdout: string): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\w+):\s*(.*)$/);
    if (m) facts[m[1]] = m[2];
    const tab = line.trim().match(/^(Replica_|Slave_|Source_|Master_)(\w+)\t(.*)$/i);
    if (tab) facts[`${tab[1]}${tab[2]}`] = tab[3];
  }
  // tabular two-line
  const lines = stdout.split('\n').filter((l) => l.trim());
  if (lines.length >= 2 && /\t/.test(lines[0])) {
    const h = lines[0].split(/\t/);
    const v = lines[1].split(/\t/);
    h.forEach((name, i) => {
      if (name) facts[name] = v[i] ?? '';
    });
  }
  return facts;
}

export function evaluateMysqlReplicaLocal(
  role: string,
  facts: Record<string, string>,
): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  const r = role.toLowerCase();
  if (r === 'primary' || r === 'master') {
    const has =
      facts.master_has_binlog === 'yes' ||
      Boolean(facts.master_File || facts.master_file || facts.File);
    if (!has) notes.push(tl('notes.auto.n0388'));
    return { ok: has, notes: notes.length ? notes : ['primary binlog OK'] };
  }
  // replica
  const io =
    (facts.Replica_IO_Running || facts.Slave_IO_Running || '').toLowerCase() === 'yes';
  const sql =
    (facts.Replica_SQL_Running || facts.Slave_SQL_Running || '').toLowerCase() ===
    'yes';
  if (!io) notes.push(`IO_Running=${facts.Replica_IO_Running || facts.Slave_IO_Running || '—'}`);
  if (!sql)
    notes.push(`SQL_Running=${facts.Replica_SQL_Running || facts.Slave_SQL_Running || '—'}`);
  const err = facts.Last_Error || facts.Last_SQL_Error || facts.Last_IO_Error;
  if (err) notes.push(`error: ${err.slice(0, 120)}`);
  return {
    ok: io && sql,
    notes: notes.length ? notes : ['replica IO+SQL running'],
  };
}

async function runMysqlQuery(
  host: HostExecutor,
  sql: string,
): Promise<{ stdout: string; exitCode: number; stderr: string }> {
  const r = await host.runCommand(['mysql', '-e', sql], { timeoutMs: 15_000 });
  if (r.exitCode === 0) return { stdout: r.stdout, exitCode: 0, stderr: r.stderr };
  const r2 = await host.runCommand(['mysql', '-e', sql.replace(/REPLICA/g, 'SLAVE').replace(/SOURCE/g, 'MASTER')], {
    timeoutMs: 15_000,
  });
  return {
    stdout: r2.stdout || r.stdout,
    exitCode: r2.exitCode,
    stderr: r2.stderr || r.stderr,
  };
}

/**
 * Probe local node; update registry.
 * Peer probes via SSH out of scope (notes only).
 */
export async function probeDbCluster(input: {
  db: JsonStore;
  host: HostExecutor;
  clusterId: string;
}): Promise<ClusterProbeResult> {
  const cluster = getDbCluster(input.db, input.clusterId);
  const notes: string[] = [];
  const at = new Date().toISOString();

  const supported = [
    'mariadb-galera',
    'mysql-replica',
    'postgres-replica',
    'redis-replica',
    'redis-sentinel',
  ];
  if (!supported.includes(cluster.kind)) {
    notes.push(tl('notes.auto.t0562', { v0: (cluster.kind) }));
    const next = updateDbCluster(input.db, cluster.id, {
      status: 'degraded',
      notes,
    });
    return { ok: false, cluster: next, facts: {}, notes, localOk: false };
  }

  const localIdx = cluster.members.findIndex((m) => m.access === 'local');
  const local =
    localIdx >= 0 ? cluster.members[localIdx] : cluster.members[0];

  let facts: Record<string, string> = {};
  let localOk = false;
  let localProbe: DbClusterMemberProbe = {
    at,
    ok: false,
    facts: {},
    notes: [tl('notes.auto.n0961')],
  };

  if (cluster.kind === 'mariadb-galera') {
    const r = await runWsrepShow(input.host);
    if (r.exitCode !== 0) {
      localProbe = {
        at,
        ok: false,
        facts: {},
        notes: [
          tl('notes.auto.t0563', { v0: ((r.stderr || r.stdout || 'exit ' + r.exitCode).slice(0, 160)) }),
        ],
      };
      notes.push(...localProbe.notes);
    } else {
      facts = parseWsrepStatus(r.stdout);
      const evaled = evaluateGaleraHealth(facts, cluster.members.length);
      localOk = evaled.ok;
      localProbe = { at, ok: localOk, facts, notes: evaled.notes };
      notes.push(...evaled.notes);
    }
  } else if (cluster.kind === 'mysql-replica') {
    const role = (local?.role || 'primary').toLowerCase();
    if (role === 'replica' || role === 'slave') {
      const r = await runMysqlQuery(input.host, 'SHOW REPLICA STATUS\\G');
      if (r.exitCode !== 0) {
        const r2 = await runMysqlQuery(input.host, 'SHOW SLAVE STATUS\\G');
        if (r2.exitCode !== 0) {
          localProbe = {
            at,
            ok: false,
            facts: {},
            notes: [
              tl('notes.auto.t0564', { v0: ((r2.stderr || r.stderr || '').slice(0, 160)) }),
            ],
          };
          notes.push(...localProbe.notes);
        } else {
          facts = parseReplicaStatus(r2.stdout);
          const evaled = evaluateMysqlReplicaLocal('replica', facts);
          localOk = evaled.ok;
          localProbe = { at, ok: localOk, facts, notes: evaled.notes };
          notes.push(...evaled.notes);
        }
      } else {
        facts = parseReplicaStatus(r.stdout);
        const evaled = evaluateMysqlReplicaLocal('replica', facts);
        localOk = evaled.ok;
        localProbe = { at, ok: localOk, facts, notes: evaled.notes };
        notes.push(...evaled.notes);
      }
    } else {
      const r = await runMysqlQuery(input.host, 'SHOW MASTER STATUS');
      if (r.exitCode !== 0) {
        const r2 = await runMysqlQuery(input.host, 'SHOW BINARY LOG STATUS');
        if (r2.exitCode !== 0) {
          localProbe = {
            at,
            ok: false,
            facts: {},
            notes: [
              tl('notes.auto.t0565', { v0: ((r2.stderr || r.stderr || '').slice(0, 160)) }),
            ],
          };
          notes.push(...localProbe.notes);
        } else {
          facts = parseMasterStatus(r2.stdout);
          const evaled = evaluateMysqlReplicaLocal('primary', facts);
          localOk = evaled.ok;
          localProbe = { at, ok: localOk, facts, notes: evaled.notes };
          notes.push(...evaled.notes);
        }
      } else {
        facts = parseMasterStatus(r.stdout);
        const evaled = evaluateMysqlReplicaLocal('primary', facts);
        localOk = evaled.ok;
        localProbe = { at, ok: localOk, facts, notes: evaled.notes };
        notes.push(...evaled.notes);
      }
    }
  } else if (cluster.kind === 'postgres-replica') {
    const role = (local?.role || 'primary').toLowerCase();
    const r = await input.host.runCommand(
      ['runuser', '-u', 'postgres', '--', 'psql', '-tAc', 'SELECT pg_is_in_recovery();'],
      { timeoutMs: 15_000 },
    );
    if (r.exitCode !== 0) {
      localProbe = {
        at,
        ok: false,
        facts: {},
        notes: [
          tl('notes.tpl.psqlFailed', { detail: (r.stderr || r.stdout || '').slice(0, 160) }),
        ],
      };
      notes.push(...localProbe.notes);
    } else {
      const recovery = r.stdout.trim().toLowerCase();
      facts.pg_is_in_recovery = recovery;
      if (role === 'replica') {
        localOk = recovery === 't' || recovery === 'true';
        notes.push(
          localOk
            ? 'replica: pg_is_in_recovery=true'
            : tl('notes.auto.t0566', { v0: (recovery) }),
        );
      } else {
        localOk = recovery === 'f' || recovery === 'false';
        notes.push(
          localOk
            ? 'primary: pg_is_in_recovery=false'
            : tl('notes.auto.t0567', { v0: (recovery) }),
        );
      }
      localProbe = { at, ok: localOk, facts, notes: [...notes] };
    }
  } else {
    // redis
    const role = (local?.role || 'master').toLowerCase();
    const r = await input.host.runCommand(
      ['redis-cli', 'INFO', 'replication'],
      { timeoutMs: 10_000 },
    );
    if (r.exitCode !== 0) {
      localProbe = {
        at,
        ok: false,
        facts: {},
        notes: [
          tl('notes.tpl.redisCliFailed', { detail: (r.stderr || r.stdout || '').slice(0, 160) }),
        ],
      };
      notes.push(...localProbe.notes);
    } else {
      for (const line of r.stdout.split('\n')) {
        const m = line.trim().match(/^([^:]+):(.+)$/);
        if (m) facts[m[1]] = m[2].trim();
      }
      const redisRole = (facts.role || '').toLowerCase();
      if (role === 'replica') {
        localOk =
          redisRole === 'slave' ||
          redisRole === 'replica' ||
          facts.master_link_status === 'up';
        notes.push(
          localOk
            ? `replica role=${facts.role} link=${facts.master_link_status ?? '—'}`
            : tl('notes.auto.t0568', { v0: (facts.role ?? '—') }),
        );
      } else if (role === 'sentinel') {
        localOk = true;
        notes.push(tl('notes.auto.n0428'));
      } else {
        localOk = redisRole === 'master';
        notes.push(
          localOk
            ? `master role=${facts.role} connected_slaves=${facts.connected_slaves ?? '—'}`
            : tl('notes.auto.t0569', { v0: (facts.role ?? '—') }),
        );
      }
      localProbe = { at, ok: localOk, facts, notes: notes.slice(-3) };
    }
  }

  const members: DbClusterMember[] = cluster.members.map((m) => {
    if (local && m.id === local.id) {
      return { ...m, lastProbe: localProbe };
    }
    return {
      ...m,
      lastProbe: m.lastProbe ?? {
        at,
        ok: false,
        facts: {},
        notes: [tl('notes.auto.n0372')],
      },
    };
  });

  let status: DbClusterStatus = 'degraded';
  if (cluster.kind === 'mariadb-galera') {
    if (localOk && cluster.members.length >= 2) {
      const size = Number(facts.wsrep_cluster_size || 0);
      if (size >= cluster.members.length) status = 'healthy';
      else if (size >= 2) {
        status = 'partial';
        notes.push(tl('notes.auto.n0997'));
      } else status = 'degraded';
    } else if (localOk && cluster.members.length === 1) {
      status = 'partial';
      notes.push(tl('notes.auto.n0626'));
    } else if (!localOk) {
      status = cluster.members.some((m) => m.applyStatus === 'applied')
        ? 'degraded'
        : 'failed';
    }
  } else {
    // mysql / postgres / redis: local OK → partial until peer probe
    if (localOk && cluster.members.length >= 2) {
      status = 'partial';
      notes.push(tl('notes.auto.n0999'));
    } else if (localOk) {
      status = 'partial';
    } else {
      status = cluster.members.some((m) => m.applyStatus === 'applied')
        ? 'degraded'
        : 'failed';
    }
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
