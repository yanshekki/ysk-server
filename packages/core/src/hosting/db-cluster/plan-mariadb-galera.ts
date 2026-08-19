import { isIpAddress, isIpv4, isNginxServerNameToken, tl } from 'ysk-server-shared';
/**
 * MariaDB Galera plan + conf render (pure; never mutates host).
 */

import type { ClusterPlan, ClusterPlanStep, DbCluster } from './types.js';

function clusterName(c: DbCluster): string {
  return String(c.params.clusterName || c.name || 'ysk-galera').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32);
}

function sstMethod(c: DbCluster): string {
  const m = String(c.params.sstMethod || 'mariabackup');
  return m === 'rsync' ? 'rsync' : 'mariabackup';
}

function galeraPort(c: DbCluster): number {
  const p = Number(c.params.galeraPort);
  return p > 0 && p < 65536 ? p : 4567;
}

/** Comma-separated gcomm addresses */
export function galeraAddressList(c: DbCluster): string {
  const port = galeraPort(c);
  return c.members
    .filter((m) => m.role !== 'arbiter' || true)
    .map((m) => `${m.host}:${port}`)
    .join(',');
}

export function renderGaleraCnf(c: DbCluster, thisHost: string): string {
  const name = clusterName(c);
  const addrs = galeraAddressList(c);
  const sst = sstMethod(c);
  const gport = galeraPort(c);
  const node = c.members.find((m) => m.host === thisHost) ?? c.members[0];
  const nodeName = (node?.label || node?.host || 'node1').replace(/[^a-zA-Z0-9_-]/g, '-');

  return `# YSK Server managed — MariaDB Galera
# written ≠ cluster healthy until nodes join and probe ok
# cluster: ${c.id} (${name})

[mysqld]
binlog_format=ROW
default_storage_engine=InnoDB
innodb_autoinc_lock_mode=2

# Bind: prefer private network IP on each node
bind-address=0.0.0.0

wsrep_on=ON
wsrep_provider=/usr/lib/galera/libgalera_smm.so
wsrep_cluster_name="${name}"
wsrep_cluster_address="gcomm://${addrs}"
wsrep_node_name="${nodeName}"
wsrep_node_address="${thisHost}"
wsrep_sst_method=${sst}
wsrep_slave_threads=4
wsrep_provider_options="gcache.size=1G;gmcast.listen_addr=tcp://0.0.0.0:${gport}"

# First bootstrap uses: galera_new_cluster (not normal systemctl start)
`;
}

export function renderGaleraPlanMarkdown(c: DbCluster): string {
  const name = clusterName(c);
  const lines = [
    `# MariaDB Galera plan — ${c.name}`,
    ``,
    `- id: \`${c.id}\``,
    `- cluster_name: \`${name}\``,
    `- members: ${c.members.map((m) => `${m.host} (${m.role}/${m.access})`).join(', ')}`,
    `- sst: ${sstMethod(c)}`,
    ``,
    `## Order`,
    `1. Install mariadb-server + galera on **all** nodes`,
    `2. Open firewall for 3306, ${galeraPort(c)}, 4444, 4568 (private net only)`,
    `3. Place conf drop-in on each node`,
    `4. **Bootstrap** first node: \`galera_new_cluster\` (or \`systemctl start mariadb\` with --wsrep-new-cluster)`,
    `5. Start remaining nodes normally; SST will sync`,
    `6. Probe: \`SHOW STATUS LIKE 'wsrep%'\` — size ≥ member count, ready ON`,
    ``,
    `## Honesty`,
    `- Plan success ≠ healthy cluster`,
    `- Requires YSK_EXECUTE + root to apply system conf on this panel host`,
    `- Peer nodes: run peer-apply.sh or push via SSH/fleet (later)`,
    ``,
  ];
  return lines.join('\n');
}

export function renderPeerApplyScript(c: DbCluster): string {
  return `#!/usr/bin/env bash
# YSK peer apply helper — review before run on EACH peer
# cluster ${c.id} (${clusterName(c)})
set -euo pipefail
CONF_SRC="\${1:-./99-ysk-galera.cnf}"
DEST="/etc/mysql/mariadb.conf.d/99-ysk-galera.cnf"
if [[ ! -f "$CONF_SRC" ]]; then
  echo "missing $CONF_SRC" >&2
  exit 2
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "need root" >&2
  exit 3
fi
install -m 644 "$CONF_SRC" "$DEST"
echo "written $DEST — start join with: systemctl restart mariadb"
echo "bootstrap only on FIRST node: galera_new_cluster"
`;
}

/**
 * Build dry-run plan for Galera (no host mutation).
 */
export function planMariadbGalera(c: DbCluster): ClusterPlan {
  const notes: string[] = [];
  const steps: ClusterPlanStep[] = [];
  const files: ClusterPlan['files'] = [];

  if (c.engine !== 'mariadb' || c.kind !== 'mariadb-galera') {
    return {
      ok: false,
      dryRun: true,
      clusterId: c.id,
      kind: c.kind,
      engine: c.engine,
      steps: [],
      files: [],
      notes: [tl('notes.auto.n1033')],
      requiresExecute: true,
      requiresRoot: true };
  }

  if (c.members.length < 2) {
    notes.push(tl('notes.auto.n0826'));
  }

  const badHosts = c.members.filter((m) => {
    const h = String(m.host ?? '').trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return !isIpv4(h);
    return !(isIpAddress(h) || isNginxServerNameToken(h));
  });
  if (badHosts.length) {
    return {
      ok: false,
      dryRun: true,
      clusterId: c.id,
      kind: c.kind,
      engine: c.engine,
      steps: [],
      files: [],
      notes: [tl('notes.needName'), ...badHosts.map((m) => String(m.host))],
      requiresExecute: true,
      requiresRoot: true,
    };
  }

  const local = c.members.find((m) => m.access === 'local') ?? c.members[0];
  const thisHost = local.host;
  const cnf = renderGaleraCnf(c, thisHost);
  const planMd = renderGaleraPlanMarkdown(c);
  const peerSh = renderPeerApplyScript(c);

  files.push(
    { relativePath: 'conf/99-ysk-galera.cnf', body: cnf },
    { relativePath: 'plan.md', body: planMd },
    { relativePath: 'scripts/peer-apply.sh', body: peerSh },
  );

  steps.push({
    id: 'conf-local',
    memberId: local.id,
    title: tl('notes.auto.t0581', { v0: (thisHost) }),
    kind: 'conf',
    body: cnf,
    risk: 'write-panel' });

  for (const m of c.members.filter((x) => x.id !== local.id)) {
    const peerCnf = renderGaleraCnf(c, m.host);
    files.push({
      relativePath: `conf/peers/${m.host.replace(/[^a-zA-Z0-9._-]/g, '_')}.cnf`,
      body: peerCnf });
    steps.push({
      id: `conf-peer-${m.id}`,
      memberId: m.id,
      title: `Peer conf ${m.host}`,
      kind: 'conf',
      body: peerCnf,
      risk: 'write-panel' });
    steps.push({
      id: `manual-peer-${m.id}`,
      memberId: m.id,
      title: tl('notes.auto.t0582', { v0: (m.host) }),
      kind: 'manual',
      body: tl('notes.auto.t0583'),
      risk: 'execute-host' });
  }

  steps.push({
    id: 'bootstrap',
    memberId: local.id,
    title: tl('notes.auto.n0083'),
    kind: 'command',
    argv: ['galera_new_cluster'],
    risk: 'execute-host' });

  steps.push({
    id: 'probe',
    title: tl('notes.auto.n0889'),
    kind: 'probe',
    risk: 'read' });

  notes.push(
    tl('notes.auto.n0032'),
    `wsrep_cluster_address=gcomm://${galeraAddressList(c)}`,
    tl('notes.auto.n1524'),
    sstMethod(c) === 'mariabackup'
      ? tl('notes.auto.n0190')
      : 'SST=rsync',
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
    requiresRoot: true };
}
