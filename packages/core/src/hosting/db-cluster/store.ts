/**
 * Persist db_clusters in JsonStore settings (max 20).
 */

import { randomUUID } from 'node:crypto';
import { ErrorCodes, YskError } from '@ysk/shared';
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
    throw new YskError(ErrorCodes.VALIDATION, `不支援的引擎：${e}`, { httpStatus: 400 });
  }
  return e as DbClusterEngine;
}

function assertKind(k: string): DbClusterKind {
  if (!KINDS.includes(k as DbClusterKind)) {
    throw new YskError(ErrorCodes.VALIDATION, `不支援的叢集類型：${k}`, { httpStatus: 400 });
  }
  return k as DbClusterKind;
}

function assertHost(host: string): string {
  const h = host.trim();
  if (!h || h.length > 253) {
    throw new YskError(ErrorCodes.VALIDATION, '節點 host 無效', { httpStatus: 400, details: { host } });
  }
  // No placeholder defaults — reject empty / whitespace only
  if (h === 'example.com' || h.startsWith('203.0.113.')) {
    throw new YskError(ErrorCodes.VALIDATION, '請填寫真實節點位址（不可用示範 IP）', {
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
  return {
    id: raw.id ?? randomUUID(),
    role,
    host: assertHost(raw.host),
    port: typeof raw.port === 'number' && raw.port > 0 ? raw.port : defaultPort(engine, role),
    label: raw.label?.trim() || undefined,
    access,
    fleetAgentId: raw.fleetAgentId,
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
    throw new YskError(ErrorCodes.NOT_FOUND, `找不到叢集：${id}`, { httpStatus: 404 });
  }
  return c;
}

export function createDbCluster(db: JsonStore, input: CreateDbClusterInput): DbCluster {
  const name = (input.name || '').trim();
  if (!name || name.length > 64) {
    throw new YskError(ErrorCodes.VALIDATION, '請填寫叢集名稱（≤64）', { httpStatus: 400 });
  }
  const engine = assertEngine(input.engine);
  const kind = assertKind(input.kind);
  if (kind.startsWith('mariadb') && engine !== 'mariadb') {
    throw new YskError(ErrorCodes.VALIDATION, 'Galera 僅支援 mariadb 引擎', { httpStatus: 400 });
  }
  if (kind.startsWith('mysql') && engine !== 'mysql') {
    throw new YskError(ErrorCodes.VALIDATION, 'mysql-replica 僅支援 mysql 引擎', { httpStatus: 400 });
  }
  if (kind.startsWith('postgres') && engine !== 'postgres') {
    throw new YskError(ErrorCodes.VALIDATION, 'postgres-replica 僅支援 postgres', { httpStatus: 400 });
  }
  if (kind.startsWith('redis') && engine !== 'redis') {
    throw new YskError(ErrorCodes.VALIDATION, 'redis 叢集僅支援 redis', { httpStatus: 400 });
  }

  const rawMembers = input.members?.length
    ? input.members
    : [{ host: '127.0.0.1', role: defaultRole(kind, 0), access: 'local' as const }];

  if (rawMembers.length < 1) {
    throw new YskError(ErrorCodes.VALIDATION, '至少需要一個節點', { httpStatus: 400 });
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
  if (kind === 'mysql-replica') {
    if (!row.params.replUser) row.params.replUser = 'ysk_repl';
    if (!row.params.serverIdBase) row.params.serverIdBase = 100;
    // Ensure first member is primary if roles missing
    if (row.members[0] && row.members[0].role === 'replica') {
      row.members[0] = { ...row.members[0], role: 'primary' };
    }
    if (row.members[0] && !['primary', 'master'].includes(row.members[0].role)) {
      row.members[0] = { ...row.members[0], role: 'primary' };
    }
    for (let i = 1; i < row.members.length; i++) {
      if (row.members[i].role === 'primary' || row.members[i].role === 'master') continue;
      if (!row.members[i].role || row.members[i].role === 'node') {
        row.members[i] = { ...row.members[i], role: 'replica' };
      }
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
    throw new YskError(ErrorCodes.NOT_FOUND, `找不到叢集：${id}`, { httpStatus: 404 });
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
