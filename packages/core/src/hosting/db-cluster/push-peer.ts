import { tl } from '@ysk/shared';
/**
 * Peer distribution: list/bundle artifacts + scp push (honest).
 * scp only with execute=true + YSK_EXECUTE; never claims peer reloaded.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { planAndMaterializeDbCluster } from './plan.js';
import { getDbCluster, updateDbCluster } from './store.js';
import type { DbCluster, DbClusterMember } from './types.js';

export type PeerBundleFile = {
  relativePath: string;
  bytes: number;
  /** absolute path on control plane */
  absolutePath: string;
};

export type PeerPushTarget = {
  memberId: string;
  host: string;
  role: string;
  username: string;
  port: number;
  /** remote directory for conf/scripts */
  remotePath: string;
  files: string[];
};

function walkFiles(dir: string, base = dir): PeerBundleFile[] {
  if (!existsSync(dir)) return [];
  const out: PeerBundleFile[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '.' || name === '..') continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walkFiles(abs, base));
    } else if (st.isFile()) {
      out.push({
        relativePath: relative(base, abs).replace(/\\/g, '/'),
        bytes: st.size,
        absolutePath: abs,
      });
    }
  }
  return out;
}

function ensureArtifacts(input: {
  db: JsonStore;
  dataDir: string;
  clusterId: string;
}): { cluster: DbCluster; artifactDir: string } {
  const { cluster } = planAndMaterializeDbCluster({
    db: input.db,
    dataDir: input.dataDir,
    clusterId: input.clusterId,
    writeArtifacts: true,
  });
  const artifactDir =
    cluster.artifactDir ?? join(input.dataDir, 'clusters', cluster.id);
  return { cluster: getDbCluster(input.db, cluster.id), artifactDir };
}

/** List files ready for peer package / download */
export function listDbClusterArtifacts(input: {
  db: JsonStore;
  dataDir: string;
  clusterId: string;
}): { ok: boolean; cluster: DbCluster; artifactDir: string; files: PeerBundleFile[]; notes: string[] } {
  const { cluster, artifactDir } = ensureArtifacts(input);
  const files = walkFiles(artifactDir);
  return {
    ok: files.length > 0,
    cluster,
    artifactDir,
    files,
    notes: files.length
      ? [tl('notes.auto.t0570', { v0: (files.length), v1: (artifactDir) })]
      : [tl('notes.auto.n0720')],
  };
}

/**
 * Build a .tar.gz under dataDir/clusters/{id}/bundle/ysk-cluster-{id}.tar.gz
 * Uses system tar when available (local process, not HostExecutor).
 */
export function bundleDbClusterArtifacts(input: {
  db: JsonStore;
  dataDir: string;
  clusterId: string;
}): {
  ok: boolean;
  cluster: DbCluster;
  bundlePath?: string;
  bytes?: number;
  notes: string[];
} {
  const listed = listDbClusterArtifacts(input);
  if (!listed.files.length) {
    return { ok: false, cluster: listed.cluster, notes: listed.notes };
  }
  const bundleDir = join(listed.artifactDir, 'bundle');
  mkdirSync(bundleDir, { recursive: true });
  const short = listed.cluster.id.slice(0, 8);
  const bundlePath = join(bundleDir, `ysk-cluster-${short}.tar.gz`);

  // README for peers
  const readme = [
    `# YSK cluster peer bundle — ${listed.cluster.name}`,
    ``,
    `- id: ${listed.cluster.id}`,
    `- kind: ${listed.cluster.kind}`,
    `- engine: ${listed.cluster.engine}`,
    ``,
    `## On each peer`,
    `1. Extract: tar -xzf ysk-cluster-*.tar.gz`,
    `2. Review conf/ and scripts/`,
    `3. Install drop-in under /etc/mysql/... (see plan.md)`,
    `4. Galera join: systemctl restart mariadb`,
    `5. MySQL replica: run scripts/replica-change-source.sql after data clone`,
    ``,
    `Control plane push uses scp of selected files only; this archive is for manual copy.`,
    ``,
  ].join('\n');
  writeFileSync(join(listed.artifactDir, 'PEER-README.md'), readme, 'utf8');

  const tar = spawnSync(
    'tar',
    ['-czf', bundlePath, '-C', listed.artifactDir, '--exclude=bundle', '.'],
    { encoding: 'utf8' },
  );
  if (tar.status !== 0) {
    return {
      ok: false,
      cluster: listed.cluster,
      notes: [
        tl('notes.auto.t0571', { v0: ((tar.stderr || tar.stdout || 'no tar').slice(0, 200)) }),
        tl('notes.auto.n0612'),
      ],
    };
  }
  const bytes = existsSync(bundlePath) ? statSync(bundlePath).size : 0;
  return {
    ok: true,
    cluster: listed.cluster,
    bundlePath,
    bytes,
    notes: [tl('notes.auto.t0572', { v0: (bundlePath), v1: (bytes) }), 'written ≠ peer applied'],
  };
}

function sshMembers(c: DbCluster): DbClusterMember[] {
  return c.members.filter((m) => m.access === 'ssh' || m.access === 'fleet');
}

function filesForMember(
  cluster: DbCluster,
  member: DbClusterMember,
  artifactDir: string,
  all: PeerBundleFile[],
): string[] {
  const paths: string[] = [];
  const rels = all.map((f) => f.relativePath);

  // Common docs/scripts
  for (const r of ['plan.md', 'PEER-README.md', 'scripts/peer-apply.sh']) {
    if (rels.includes(r)) paths.push(r);
  }
  for (const r of rels.filter((x) => x.startsWith('scripts/'))) {
    if (!paths.includes(r)) paths.push(r);
  }

  const safe = member.host.replace(/[^a-zA-Z0-9._-]/g, '_');
  const role = (member.role || '').toLowerCase();

  if (cluster.kind === 'mariadb-galera') {
    const peerCnf = `conf/peers/${safe}.cnf`;
    if (rels.includes(peerCnf)) paths.push(peerCnf);
    else if (rels.includes('conf/99-ysk-galera.cnf')) {
      paths.push('conf/99-ysk-galera.cnf');
    }
  } else if (cluster.kind === 'mysql-replica') {
    if (role === 'primary' || role === 'master') {
      if (rels.includes('conf/99-ysk-mysql-primary.cnf')) {
        paths.push('conf/99-ysk-mysql-primary.cnf');
      }
    } else {
      const peerCnf = `conf/peers/${safe}-replica.cnf`;
      if (rels.includes(peerCnf)) paths.push(peerCnf);
      else {
        const any = rels.find((x) => x.startsWith('conf/peers/') && x.endsWith('-replica.cnf'));
        if (any) paths.push(any);
      }
    }
  } else if (cluster.kind === 'postgres-replica') {
    if (role === 'primary' || role === 'master') {
      if (rels.includes('conf/99-ysk-postgres-primary.conf')) {
        paths.push('conf/99-ysk-postgres-primary.conf');
      }
    } else {
      const peerCnf = `conf/peers/${safe}-replica.conf`;
      if (rels.includes(peerCnf)) paths.push(peerCnf);
    }
  } else if (cluster.kind === 'redis-replica' || cluster.kind === 'redis-sentinel') {
    if (role === 'sentinel') {
      const sc = `conf/peers/${safe}-sentinel.conf`;
      if (rels.includes(sc)) paths.push(sc);
    } else if (role === 'replica') {
      const rc = `conf/peers/${safe}-replica.conf`;
      if (rels.includes(rc)) paths.push(rc);
    } else if (rels.includes('conf/99-ysk-redis-master.conf')) {
      paths.push('conf/99-ysk-redis-master.conf');
    }
  }

  return [...new Set(paths)].filter((p) => existsSync(join(artifactDir, p)));
}

export function planDbClusterPeerPush(input: {
  db: JsonStore;
  dataDir: string;
  clusterId: string;
  memberId?: string;
}): {
  ok: boolean;
  dryRun: true;
  cluster: DbCluster;
  targets: PeerPushTarget[];
  notes: string[];
} {
  const listed = listDbClusterArtifacts(input);
  const peers = sshMembers(listed.cluster).filter(
    (m) => !input.memberId || m.id === input.memberId,
  );
  const targets: PeerPushTarget[] = peers.map((m) => ({
    memberId: m.id,
    host: m.host,
    role: m.role,
    username: m.ssh?.username || 'root',
    port: m.ssh?.port || 22,
    remotePath: `/tmp/ysk-cluster-${listed.cluster.id.slice(0, 8)}`,
    files: filesForMember(listed.cluster, m, listed.artifactDir, listed.files),
  }));

  const notes = [
    tl('notes.auto.n0263'),
    targets.length
      ? tl('notes.auto.t0573', { v0: (targets.length) })
      : tl('notes.auto.n1069'),
    tl('notes.auto.n1284'),
    tl('notes.auto.n0424'),
  ];
  for (const t of targets) {
    notes.push(`${t.host}: ${t.files.length} files → ${t.username}@${t.host}:${t.remotePath}/`);
  }

  return {
    ok: targets.length > 0 && targets.every((t) => t.files.length > 0),
    dryRun: true,
    cluster: listed.cluster,
    targets,
    notes,
  };
}

/**
 * scp peer files. Default dry-run lists targets only.
 */
export async function pushDbClusterToPeers(input: {
  db: JsonStore;
  dataDir: string;
  host: HostExecutor;
  clusterId: string;
  memberId?: string;
  /** default false */
  execute?: boolean;
  /** vault identity for all peers (override member.ssh.identityId) */
  identityId?: string;
}): Promise<{
  ok: boolean;
  dryRun: boolean;
  executed: boolean;
  blocked?: boolean;
  cluster: DbCluster;
  targets: PeerPushTarget[];
  notes: string[];
  requiresExecute: boolean;
  identityUsed?: string;
}> {
  const plan = planDbClusterPeerPush(input);
  const want = input.execute === true;

  if (!want) {
    return {
      ok: plan.ok,
      dryRun: true,
      executed: false,
      cluster: plan.cluster,
      targets: plan.targets,
      notes: plan.notes,
      requiresExecute: true,
    };
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      dryRun: false,
      executed: false,
      blocked: true,
      cluster: plan.cluster,
      targets: plan.targets,
      notes: [tl('notes.auto.n1136'), ...plan.notes.slice(0, 3)],
      requiresExecute: true,
    };
  }

  if (!plan.targets.length) {
    return {
      ok: false,
      dryRun: false,
      executed: false,
      cluster: plan.cluster,
      targets: [],
      notes: [tl('notes.auto.n1086')],
      requiresExecute: false,
    };
  }

  const listed = listDbClusterArtifacts(input);
  const notes: string[] = [];
  let anyFail = false;

  // Resolve per-target identity from member or global flag
  const { resolveIdentityKeyPath, buildIdentityFileOpts } = await import(
    '../../security/ssh-identity/ops.js'
  );
  const memberByHost = new Map(
    plan.cluster.members.map((m) => [m.host, m] as const),
  );
  let identityUsed: string | undefined;

  for (const t of plan.targets) {
    const mem = memberByHost.get(t.host);
    const idId = mem?.ssh?.identityId || input.identityId;
    let idOpts: string[] = [];
    if (idId) {
      const key = resolveIdentityKeyPath(input.dataDir, idId);
      if (key.ok && key.path) {
        idOpts = buildIdentityFileOpts(key.path);
        identityUsed = idId;
      } else {
        notes.push(tl('notes.auto.t0574', { v0: (t.host), v1: (idId) }));
      }
    }

    // mkdir remote
    const mkdir = await input.host.runCommand(
      [
        'ssh',
        ...idOpts,
        ...(idOpts.length
          ? []
          : ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes']),
        '-p',
        String(t.port),
        `${t.username}@${t.host}`,
        `mkdir`,
        '-p',
        t.remotePath,
      ],
      { timeoutMs: 30_000 },
    );
    if (mkdir.exitCode !== 0) {
      anyFail = true;
      notes.push(
        tl('notes.auto.t0575', { v0: (t.host), v1: ((mkdir.stderr || mkdir.stdout || '').slice(0, 120)) }),
      );
      continue;
    }

    for (const rel of t.files) {
      const local = join(listed.artifactDir, rel);
      if (!existsSync(local)) {
        anyFail = true;
        notes.push(tl('notes.auto.t0576', { v0: (t.host), v1: (rel) }));
        continue;
      }
      // preserve subdirs on remote with scp -r of parent or flat copy with basename
      const remoteFile = `${t.username}@${t.host}:${t.remotePath}/${rel.replace(/\//g, '__')}`;
      const r = await input.host.runCommand(
        [
          'scp',
          ...idOpts,
          ...(idOpts.length
            ? []
            : ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes']),
          '-P',
          String(t.port),
          local,
          remoteFile,
        ],
        { timeoutMs: 60_000 },
      );
      if (r.exitCode !== 0) {
        anyFail = true;
        notes.push(
          tl('notes.auto.t0577', { v0: (t.host), v1: (rel), v2: ((r.stderr || r.stdout || '').slice(0, 100)) }),
        );
      } else {
        notes.push(`${t.host}/${rel}: scp ok → ${t.remotePath}/`);
      }
    }
  }

  notes.push(
    anyFail
      ? tl('notes.auto.n1494')
      : tl('notes.auto.n0729'),
    tl('notes.auto.n1386'),
  );

  // Mark ssh members as written if any file succeeded
  const members = plan.cluster.members.map((m) => {
    if (m.access !== 'ssh' && m.access !== 'fleet') return m;
    if (input.memberId && m.id !== input.memberId) return m;
    return { ...m, applyStatus: anyFail ? m.applyStatus : ('written' as const) };
  });
  const cluster = updateDbCluster(input.db, plan.cluster.id, {
    members,
    notes: notes.slice(0, 30),
    status: anyFail ? 'partial' : plan.cluster.status === 'draft' ? 'planned' : plan.cluster.status,
  });

  return {
    ok: !anyFail,
    dryRun: false,
    executed: true,
    cluster,
    targets: plan.targets,
    notes,
    identityUsed,
    requiresExecute: false,
  };
}

/** Read bundle file bytes for HTTP download */
export function readDbClusterBundleFile(bundlePath: string): Buffer | null {
  if (!existsSync(bundlePath) || !bundlePath.includes('/clusters/')) return null;
  if (bundlePath.includes('..')) return null;
  try {
    return readFileSync(bundlePath);
  } catch {
    return null;
  }
}
