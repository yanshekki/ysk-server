import { tl } from '@ysk-server/shared';
/**
 * Peer probe (SSH) + remote conf install/restart after scp.
 * Fixed argv templates only; honest status aggregation.
 */

import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import {
  evaluateGaleraHealth,
  evaluateMysqlReplicaLocal,
  parseMasterStatus,
  parseReplicaStatus,
  parseWsrepStatus,
  probeDbCluster,
  type ClusterProbeResult } from './probe.js';
import { listDbClusterArtifacts } from './push-peer.js';
import { getDbCluster, updateDbCluster } from './store.js';
import type {
  DbCluster,
  DbClusterKind,
  DbClusterMember,
  DbClusterMemberProbe,
  DbClusterStatus } from './types.js';

function sshBase(
  m: DbClusterMember,
  identityPath?: string,
): string[] {
  const user = m.ssh?.username || 'root';
  const port = m.ssh?.port || 22;
  const base = ['ssh'];
  if (identityPath) {
    base.push(
      '-i',
      identityPath,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ConnectTimeout=8',
    );
  } else {
    base.push(
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=8',
    );
  }
  base.push('-p', String(port), `${user}@${m.host}`);
  return base;
}

async function sshRun(
  host: HostExecutor,
  m: DbClusterMember,
  remoteArgv: string[],
  identityPath?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const argv = [...sshBase(m, identityPath), ...remoteArgv];
  const r = await host.runCommand(argv, { timeoutMs: 25_000 });
  return { exitCode: r.exitCode, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function resolveMemberIdentityPath(
  dataDir: string | undefined,
  m: DbClusterMember,
  fallbackIdentityId?: string,
): Promise<string | undefined> {
  const id = m.ssh?.identityId || fallbackIdentityId;
  if (!id || !dataDir) return undefined;
  try {
    const { resolveIdentityKeyPath } = await import('../../security/ssh-identity/ops.js');
    const r = resolveIdentityKeyPath(dataDir, id);
    return r.ok ? r.path : undefined;
  } catch {
    return undefined;
  }
}

async function probeMemberSsh(
  host: HostExecutor,
  cluster: DbCluster,
  m: DbClusterMember,
  identityPath?: string,
): Promise<DbClusterMemberProbe> {
  const at = new Date().toISOString();
  const role = (m.role || '').toLowerCase();
  const kind = cluster.kind;
  const run = (argv: string[]) => sshRun(host, m, argv, identityPath);

  if (kind === 'mariadb-galera') {
    const r = await run([
      'mysql',
      '-N',
      '-e',
      "SHOW STATUS LIKE 'wsrep%';",
    ]);
    if (r.exitCode !== 0) {
      const r2 = await run([
        'mariadb',
        '-N',
        '-e',
        "SHOW STATUS LIKE 'wsrep%';",
      ]);
      if (r2.exitCode !== 0) {
        return {
          at,
          ok: false,
          facts: {},
          notes: [tl('notes.auto.t0591', { v0: ((r2.stderr || r.stderr).slice(0, 120)) })] };
      }
      const facts = parseWsrepStatus(r2.stdout);
      const ev = evaluateGaleraHealth(facts, cluster.members.length);
      return { at, ok: ev.ok, facts, notes: ev.notes };
    }
    const facts = parseWsrepStatus(r.stdout);
    const ev = evaluateGaleraHealth(facts, cluster.members.length);
    return { at, ok: ev.ok, facts, notes: ev.notes };
  }

  if (kind === 'mysql-replica') {
    if (role === 'replica' || role === 'slave') {
      const r = await run(['mysql', '-e', 'SHOW REPLICA STATUS\\G']);
      const out = r.exitCode === 0 ? r : await run(['mysql', '-e', 'SHOW SLAVE STATUS\\G']);
      if (out.exitCode !== 0) {
        return {
          at,
          ok: false,
          facts: {},
          notes: [tl('notes.auto.t0592', { v0: (out.stderr.slice(0, 120)) })] };
      }
      const facts = parseReplicaStatus(out.stdout);
      const ev = evaluateMysqlReplicaLocal('replica', facts);
      return { at, ok: ev.ok, facts, notes: ev.notes };
    }
    const r = await run(['mysql', '-e', 'SHOW MASTER STATUS']);
    if (r.exitCode !== 0) {
      return {
        at,
        ok: false,
        facts: {},
        notes: [tl('notes.auto.t0593', { v0: (r.stderr.slice(0, 120)) })] };
    }
    const facts = parseMasterStatus(r.stdout);
    const ev = evaluateMysqlReplicaLocal('primary', facts);
    return { at, ok: ev.ok, facts, notes: ev.notes };
  }

  if (kind === 'postgres-replica') {
    const r = await run([
      'psql',
      '-tAc',
      'SELECT pg_is_in_recovery();',
    ]);
    if (r.exitCode !== 0) {
      return {
        at,
        ok: false,
        facts: {},
        notes: [tl('notes.tpl.psqlFailed', { detail: r.stderr.slice(0, 120) })] };
    }
    const recovery = r.stdout.trim().toLowerCase();
    const facts = { pg_is_in_recovery: recovery };
    const ok =
      role === 'replica'
        ? recovery === 't' || recovery === 'true'
        : recovery === 'f' || recovery === 'false';
    return {
      at,
      ok,
      facts,
      notes: [ok ? `pg_is_in_recovery=${recovery}` : `unexpected recovery=${recovery}`] };
  }

  // redis
  const r = await run(['redis-cli', 'INFO', 'replication']);
  if (r.exitCode !== 0) {
    return {
      at,
      ok: false,
      facts: {},
      notes: [tl('notes.tpl.redisCliFailed', { detail: r.stderr.slice(0, 120) })] };
  }
  const facts: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) {
    const mm = line.trim().match(/^([^:]+):(.+)$/);
    if (mm) facts[mm[1]] = mm[2].trim();
  }
  const redisRole = (facts.role || '').toLowerCase();
  let ok = false;
  if (role === 'replica') {
    ok =
      redisRole === 'slave' ||
      redisRole === 'replica' ||
      facts.master_link_status === 'up';
  } else if (role === 'sentinel') {
    ok = true;
  } else {
    ok = redisRole === 'master';
  }
  return {
    at,
    ok,
    facts,
    notes: [`role=${facts.role ?? '—'} link=${facts.master_link_status ?? '—'}`] };
}

function aggregateStatus(
  kind: DbClusterKind,
  members: DbClusterMember[],
  localOk: boolean,
): { status: DbClusterStatus; notes: string[] } {
  const notes: string[] = [];
  const okCount = members.filter((m) => m.lastProbe?.ok).length;
  const total = members.length;

  if (kind === 'mariadb-galera') {
    const local = members.find((m) => m.access === 'local');
    const size = Number(local?.lastProbe?.facts?.wsrep_cluster_size || 0);
    if (okCount >= total && size >= total) {
      return { status: 'healthy', notes: [tl('notes.auto.t0594', { v0: (total), v1: (size) })] };
    }
    if (localOk || okCount >= 1) {
      notes.push(`probe OK ${okCount}/${total}` + (size ? ` · wsrep_size=${size}` : ''));
      return { status: okCount >= 2 || size >= 2 ? 'partial' : 'degraded', notes };
    }
    return { status: 'failed', notes: [tl('notes.auto.n0035')] };
  }

  // replica topologies: healthy if all members lastProbe.ok
  if (okCount >= total && total >= 2) {
    return { status: 'healthy', notes: [tl('notes.auto.t0595', { v0: (total) })] };
  }
  if (okCount >= 1) {
    return {
      status: 'partial',
      notes: [`probe OK ${okCount}/${total}`] };
  }
  return { status: 'failed', notes: [tl('notes.auto.n0035')] };
}

/**
 * Full probe: local + SSH peers. Fleet members: note only (use fleet op=probe).
 */
export async function probeDbClusterFull(input: {
  db: JsonStore;
  host: HostExecutor;
  clusterId: string;
  /** skip SSH peers */
  localOnly?: boolean;
  dataDir?: string;
  /** default vault identity for all ssh peers */
  identityId?: string;
}): Promise<ClusterProbeResult & { peersProbed: number }> {
  const localResult = await probeDbCluster(input);
  let cluster = localResult.cluster;
  const notes = [...localResult.notes];
  let peersProbed = 0;

  if (input.localOnly || !input.host.executeEnabled()) {
    if (!input.localOnly && !input.host.executeEnabled()) {
      notes.push(tl('notes.auto.n0371'));
    }
    return { ...localResult, notes, peersProbed: 0 };
  }

  const members = [...cluster.members];
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (m.access === 'local') continue;
    if (m.access === 'fleet') {
      members[i] = {
        ...m,
        lastProbe: {
          at: new Date().toISOString(),
          ok: false,
          facts: {},
          notes: [tl('notes.auto.n0292')] } };
      continue;
    }
    // ssh
    const idPath = await resolveMemberIdentityPath(
      input.dataDir,
      m,
      input.identityId,
    );
    const probe = await probeMemberSsh(input.host, cluster, m, idPath);
    members[i] = { ...m, lastProbe: probe };
    peersProbed += 1;
    notes.push(
      `${m.host}: ${probe.ok ? 'OK' : 'FAIL'} — ${probe.notes[0] ?? ''}${idPath ? ' [identity]' : ''}`,
    );
  }

  const agg = aggregateStatus(cluster.kind, members, localResult.localOk);
  notes.push(...agg.notes);

  cluster = updateDbCluster(input.db, cluster.id, {
    members,
    status: agg.status,
    notes: notes.slice(0, 40) });

  return {
    ok: agg.status === 'healthy',
    cluster,
    facts: localResult.facts,
    notes: cluster.notes,
    localOk: localResult.localOk,
    peersProbed };
}

export type RemoteInstallResult = {
  ok: boolean;
  dryRun: boolean;
  executed: boolean;
  blocked?: boolean;
  notes: string[];
  cluster: DbCluster;
  installed: Array<{ host: string; ok: boolean; detail: string }>;
};

function unitFor(cluster: DbCluster, m: DbClusterMember): string {
  if (cluster.kind === 'mariadb-galera') return 'mariadb';
  if (cluster.kind === 'mysql-replica') return 'mysql';
  if (cluster.kind === 'postgres-replica') return 'postgresql';
  if ((m.role || '').toLowerCase() === 'sentinel') return 'redis-sentinel';
  return 'redis-server';
}

function remoteConfDest(cluster: DbCluster, m: DbClusterMember): string {
  const role = (m.role || '').toLowerCase();
  if (cluster.kind === 'mariadb-galera') {
    return '/etc/mysql/mariadb.conf.d/99-ysk-galera.cnf';
  }
  if (cluster.kind === 'mysql-replica') {
    return '/etc/mysql/mysql.conf.d/99-ysk-mysql-repl.cnf';
  }
  if (cluster.kind === 'postgres-replica') {
    return '/etc/postgresql/ysk-repl.conf';
  }
  if (role === 'sentinel') return '/etc/redis/sentinel-ysk.conf';
  return '/etc/redis/redis-ysk-repl.conf';
}

/**
 * After scp to /tmp/ysk-cluster-*, install conf on peer and restart unit.
 * Requires files already pushed (or we scp the main conf again).
 */
export async function installDbClusterOnPeers(input: {
  db: JsonStore;
  dataDir: string;
  host: HostExecutor;
  clusterId: string;
  memberId?: string;
  execute?: boolean;
  /** also restart unit after install */
  restart?: boolean;
  identityId?: string;
}): Promise<RemoteInstallResult> {
  const cluster = getDbCluster(input.db, input.clusterId);
  const want = input.execute === true;
  const restart = input.restart !== false;
  const listed = listDbClusterArtifacts(input);
  const peers = cluster.members.filter(
    (m) =>
      m.access === 'ssh' &&
      (!input.memberId || m.id === input.memberId),
  );

  const installed: RemoteInstallResult['installed'] = [];
  const notes: string[] = [];

  if (!peers.length) {
    return {
      ok: false,
      dryRun: !want,
      executed: false,
      cluster,
      notes: [tl('notes.auto.n1085')],
      installed: [] };
  }

  if (!want) {
    for (const m of peers) {
      installed.push({
        host: m.host,
        ok: true,
        detail: tl('notes.auto.t0596', { v0: (remoteConfDest(cluster, m)), v1: (restart ? 'restart ' + unitFor(cluster, m) : tl('notes.tpl.noRestart')) }) });
    }
    return {
      ok: true,
      dryRun: true,
      executed: false,
      cluster,
      notes: [tl('notes.auto.n0264'), ...installed.map((i) => `${i.host}: ${i.detail}`)],
      installed };
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      dryRun: false,
      executed: false,
      blocked: true,
      cluster,
      notes: [tl('notes.auto.n1480')],
      installed: [] };
  }

  let anyFail = false;
  const short = cluster.id.slice(0, 8);
  const remoteDir = `/tmp/ysk-cluster-${short}`;

  for (const m of peers) {
    // Find local conf for this member
    const files = listed.files.map((f) => f.relativePath);
    const safe = m.host.replace(/[^a-zA-Z0-9._-]/g, '_');
    let localRel =
      cluster.kind === 'mariadb-galera'
        ? files.find((f) => f === `conf/peers/${safe}.cnf`) ||
          'conf/99-ysk-galera.cnf'
        : cluster.kind === 'mysql-replica'
          ? (m.role || '').toLowerCase() === 'replica'
            ? files.find((f) => f.includes(`${safe}-replica`)) ||
              files.find((f) => f.endsWith('-replica.cnf'))
            : 'conf/99-ysk-mysql-primary.cnf'
          : cluster.kind === 'postgres-replica'
            ? (m.role || '').toLowerCase() === 'replica'
              ? files.find((f) => f.includes(`${safe}-replica`))
              : 'conf/99-ysk-postgres-primary.conf'
            : (m.role || '').toLowerCase() === 'replica'
              ? files.find((f) => f.includes(`${safe}-replica`))
              : (m.role || '').toLowerCase() === 'sentinel'
                ? files.find((f) => f.includes(`${safe}-sentinel`))
                : 'conf/99-ysk-redis-master.conf';

    if (!localRel || !existsSync(join(listed.artifactDir, localRel))) {
      anyFail = true;
      installed.push({ host: m.host, ok: false, detail: tl('notes.auto.n0989') });
      continue;
    }

    const localPath = join(listed.artifactDir, localRel);
    const flat = basename(localRel);
    const user = m.ssh?.username || 'root';
    const port = String(m.ssh?.port || 22);
    const dest = remoteConfDest(cluster, m);
    const unit = unitFor(cluster, m);
    const idPath = await resolveMemberIdentityPath(
      input.dataDir,
      m,
      input.identityId,
    );

    await sshRun(input.host, m, ['mkdir', '-p', remoteDir], idPath);
    const scpArgv = idPath
      ? [
          'scp',
          '-i',
          idPath,
          '-o',
          'IdentitiesOnly=yes',
          '-o',
          'BatchMode=yes',
          '-o',
          'StrictHostKeyChecking=accept-new',
          '-P',
          port,
          localPath,
          `${user}@${m.host}:${remoteDir}/${flat}`,
        ]
      : [
          'scp',
          '-o',
          'StrictHostKeyChecking=no',
          '-o',
          'BatchMode=yes',
          '-P',
          port,
          localPath,
          `${user}@${m.host}:${remoteDir}/${flat}`,
        ];
    const scp = await input.host.runCommand(scpArgv, { timeoutMs: 60_000 });
    if (scp.exitCode !== 0) {
      anyFail = true;
      installed.push({
        host: m.host,
        ok: false,
        detail: tl('notes.auto.t0597', { v0: ((scp.stderr || scp.stdout).slice(0, 80)) }) });
      continue;
    }

    // ensure dest dir + install
    const destDir = dest.includes('/') ? dest.replace(/\/[^/]+$/, '') : '/tmp';
    await sshRun(input.host, m, ['mkdir', '-p', destDir], idPath);
    const inst = await sshRun(
      input.host,
      m,
      ['install', '-m', '644', `${remoteDir}/${flat}`, dest],
      idPath,
    );
    if (inst.exitCode !== 0) {
      anyFail = true;
      installed.push({
        host: m.host,
        ok: false,
        detail: tl('notes.auto.t0598', { v0: ((inst.stderr || inst.stdout).slice(0, 100)) }) });
      continue;
    }

    if (restart) {
      const rs = await sshRun(input.host, m, ['systemctl', 'restart', unit], idPath);
      if (rs.exitCode !== 0) {
        anyFail = true;
        installed.push({
          host: m.host,
          ok: false,
          detail: tl('notes.auto.t0599', { v0: (unit) }) });
        continue;
      }
    }

    installed.push({
      host: m.host,
      ok: true,
      detail: tl('notes.tpl.peerInstalled', { dest, restart: restart ? ` + restart ${unit}` : '' }) });
  }

  const members = cluster.members.map((m) => {
    const row = installed.find((i) => i.host === m.host);
    if (!row) return m;
    return {
      ...m,
      applyStatus: row.ok ? ('applied' as const) : ('failed' as const) };
  });

  notes.push(...installed.map((i) => `${i.host}: ${i.ok ? 'OK' : 'FAIL'} — ${i.detail}`));
  notes.push(tl('notes.auto.n1475'));

  const next = updateDbCluster(input.db, cluster.id, {
    members,
    status: anyFail ? 'partial' : 'partial',
    notes: notes.slice(0, 40) });

  return {
    ok: !anyFail,
    dryRun: false,
    executed: true,
    cluster: next,
    notes,
    installed };
}

/** Firewall ports recommended for a cluster kind */
export function firewallPortsForCluster(kind: DbClusterKind): number[] {
  if (kind === 'mariadb-galera') return [3306, 4567, 4444, 4568];
  if (kind === 'mysql-replica') return [3306];
  if (kind === 'postgres-replica') return [5432];
  if (kind === 'redis-sentinel') return [6379, 26379];
  return [6379];
}
