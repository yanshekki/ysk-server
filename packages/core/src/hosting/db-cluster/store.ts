/**
 * Persist db_clusters in JsonStore settings (max 20).
 */

import { randomUUID } from 'node:crypto';
import { ErrorCodes, YskError, tl} from 'ysk-server-shared';
import type { JsonStore } from '../../db/store.js';
import type {
  CreateDbClusterInput,
  DbCluster,
  DbClusterEngine,
  DbClusterKind,
  DbClusterMember,
  DbClusterStatus,
} from './types.js';

const KEY = 'db_clusters';
const MAX = 20;

const KINDS: DbClusterKind[] = [
  'mariadb-galera',
  'mysql-replica',
  'postgres-replica',
  'redis-replica',
  'redis-sentinel',
];

const ENGINES: DbClusterEngine[] = ['mysql', 'mariadb', 'postgres', 'redis'];

function assertEngine(e: string): DbClusterEngine {
  if (!ENGINES.includes(e as DbClusterEngine)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0601', { v0: (e) }), { httpStatus: 400 });
  }
  return e as DbClusterEngine;
}

export function engineFromKind(kind: string): DbClusterEngine | undefined {
  if (kind.startsWith('mariadb')) return 'mariadb';
  if (kind.startsWith('mysql')) return 'mysql';
  if (kind.startsWith('postgres')) return 'postgres';
  if (kind.startsWith('redis')) return 'redis';
  return undefined;
}

function assertKind(k: string): DbClusterKind {
  if (!KINDS.includes(k as DbClusterKind)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0602', { v0: (k) }), { httpStatus: 400 });
  }
  return k as DbClusterKind;
}

function assertHost(host: string): string {
  const h = host.trim();
  if (!h || h.length > 253) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1303'), { httpStatus: 400, details: { host } });
  }
  // No placeholder defaults — reject empty / whitespace only
  if (h === 'example.com' || h.startsWith('203.0.113.')) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1397'), {
      httpStatus: 400,
      details: { host },
    });
  }
  return h;
}

function defaultPort(engine: DbClusterEngine, role: string): number {
  if (engine === 'redis') return role === 'sentinel' ? 26379 : 6379;
  if (engine === 'postgres') return 5432;
  return 3306;
}

function defaultRole(kind: DbClusterKind, index: number): string {
  if (kind === 'mariadb-galera') return 'node';
  if (kind === 'redis-sentinel') return index === 0 ? 'master' : index === 1 ? 'replica' : 'sentinel';
  if (kind === 'redis-replica') return index === 0 ? 'master' : 'replica';
  return index === 0 ? 'primary' : 'replica';
}

function normalizeMember(
  raw: Partial<DbClusterMember> & { host: string; role?: string },
  engine: DbClusterEngine,
  kind: DbClusterKind,
  index: number,
): DbClusterMember {
  const role = (raw.role || defaultRole(kind, index)).trim();
  const access = raw.access === 'ssh' || raw.access === 'fleet' || raw.access === 'local'
    ? raw.access
    : index === 0
      ? 'local'
      : 'ssh';
  if (access === 'fleet' && !raw.fleetAgentId?.trim()) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0216'), {
      httpStatus: 400,
      details: { host: raw.host },
    });
  }
  return {
    id: raw.id ?? randomUUID(),
    role,
    host: assertHost(raw.host),
    port: typeof raw.port === 'number' && raw.port > 0 ? raw.port : defaultPort(engine, role),
    label: raw.label?.trim() || undefined,
    access,
    fleetAgentId: raw.fleetAgentId?.trim() || undefined,
    ssh: raw.ssh
      ? {
          username: String(raw.ssh.username || 'root').trim() || 'root',
          port: Number(raw.ssh.port) || 22,
        }
      : access === 'ssh'
        ? { username: 'root', port: 22 }
        : undefined,
    applyStatus: raw.applyStatus ?? 'none',
    lastProbe: raw.lastProbe,
  };
}

export function listDbClusters(db: JsonStore, engine?: DbClusterEngine): DbCluster[] {
  let all: DbCluster[] = [];
  try {
    all = JSON.parse(db.snapshot.settings?.[KEY] ?? '[]') as DbCluster[];
    if (!Array.isArray(all)) all = [];
  } catch {
    all = [];
  }
  if (engine) return all.filter((c) => c.engine === engine);
  return all;
}

function saveAll(db: JsonStore, rows: DbCluster[]): void {
  db.snapshot.settings[KEY] = JSON.stringify(rows.slice(0, MAX));
  db.persist();
}

export function getDbCluster(db: JsonStore, id: string): DbCluster {
  const c = listDbClusters(db).find((x) => x.id === id);
  if (!c) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.tpl.clusterNotFound', { id: id }), { httpStatus: 404 });
  }
  return c;
}

export function createDbCluster(db: JsonStore, input: CreateDbClusterInput): DbCluster {
  const name = (input.name || '').trim();
  if (!name || name.length > 64) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1394'), { httpStatus: 400 });
  }
  const engine = assertEngine(input.engine);
  const kind = assertKind(input.kind);
  if (kind.startsWith('mariadb') && engine !== 'mariadb') {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0108'), { httpStatus: 400 });
  }
  if (kind.startsWith('mysql') && engine !== 'mysql') {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0335'), { httpStatus: 400 });
  }
  if (kind.startsWith('postgres') && engine !== 'postgres') {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0384'), { httpStatus: 400 });
  }
  if (kind.startsWith('redis') && engine !== 'redis') {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0403'), { httpStatus: 400 });
  }

  const rawMembers = input.members?.length
    ? input.members
    : [{ host: '127.0.0.1', role: defaultRole(kind, 0), access: 'local' as const }];

  if (rawMembers.length < 1) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1342'), { httpStatus: 400 });
  }

  const members = rawMembers.map((m, i) => normalizeMember(m, engine, kind, i));
  const now = new Date().toISOString();
  const row: DbCluster = {
    id: randomUUID(),
    name,
    engine,
    kind,
    status: 'draft',
    members,
    params: { ...(input.params ?? {}) },
    notes: [],
    createdAt: now,
    updatedAt: now,
  };

  // defaults by kind
  if (kind === 'mariadb-galera') {
    if (!row.params.clusterName) row.params.clusterName = name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32) || 'ysk-galera';
    if (!row.params.sstMethod) row.params.sstMethod = 'mariabackup';
    if (!row.params.galeraPort) row.params.galeraPort = 4567;
  }
  if (kind === 'mysql-replica' || kind === 'postgres-replica') {
    if (!row.params.replUser) row.params.replUser = 'ysk_repl';
    if (kind === 'mysql-replica' && !row.params.serverIdBase) {
      row.params.serverIdBase = 100;
    }
    if (row.members[0] && !['primary', 'master'].includes(row.members[0].role)) {
      row.members[0] = { ...row.members[0], role: 'primary' };
    }
    for (let i = 1; i < row.members.length; i++) {
      if (['primary', 'master', 'sentinel'].includes(row.members[i].role)) continue;
      if (!row.members[i].role || row.members[i].role === 'node') {
        row.members[i] = { ...row.members[i], role: 'replica' };
      }
    }
  }
  if (kind === 'redis-replica' || kind === 'redis-sentinel') {
    if (!row.params.port) row.params.port = 6379;
    if (row.members[0] && !['master', 'primary'].includes(row.members[0].role)) {
      row.members[0] = { ...row.members[0], role: 'master' };
    }
    for (let i = 1; i < row.members.length; i++) {
      if (row.members[i].role === 'sentinel') continue;
      if (!row.members[i].role || row.members[i].role === 'node') {
        row.members[i] = { ...row.members[i], role: 'replica' };
      }
    }
    if (kind === 'redis-sentinel' && !row.params.sentinelName) {
      row.params.sentinelName = name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32) || 'ysk-redis';
    }
  }

  const all = listDbClusters(db);
  saveAll(db, [row, ...all]);
  return row;
}

export function updateDbCluster(
  db: JsonStore,
  id: string,
  patch: Partial<Pick<DbCluster, 'name' | 'members' | 'params' | 'status' | 'notes' | 'artifactDir'>>,
): DbCluster {
  const all = listDbClusters(db);
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.tpl.clusterNotFound', { id: id }), { httpStatus: 404 });
  }
  const cur = all[idx];
  const next: DbCluster = {
    ...cur,
    name: patch.name?.trim() || cur.name,
    params: patch.params ? { ...cur.params, ...patch.params } : cur.params,
    status: (patch.status as DbClusterStatus) ?? cur.status,
    notes: patch.notes ?? cur.notes,
    artifactDir: patch.artifactDir ?? cur.artifactDir,
    members: patch.members
      ? patch.members.map((m, i) =>
          normalizeMember(
            { ...m, host: m.host },
            cur.engine,
            cur.kind,
            i,
          ),
        )
      : cur.members,
    updatedAt: new Date().toISOString(),
  };
  all[idx] = next;
  saveAll(db, all);
  return next;
}

export function deleteDbCluster(db: JsonStore, id: string): boolean {
  const all = listDbClusters(db);
  const next = all.filter((c) => c.id !== id);
  if (next.length === all.length) return false;
  saveAll(db, next);
  return true;
}

export function setDbClusterStatus(
  db: JsonStore,
  id: string,
  status: DbClusterStatus,
  notes?: string[],
): DbCluster {
  const cur = getDbCluster(db, id);
  return updateDbCluster(db, id, {
    status,
    notes: notes ?? cur.notes,
  });
}
