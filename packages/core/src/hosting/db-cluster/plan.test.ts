import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonStore } from '../../db/store.js';
import { createDbCluster } from './store.js';
import { planAndMaterializeDbCluster, planDbCluster } from './plan.js';
import type { DbCluster, DbClusterMember } from './types.js';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ysk-plan-'));
  tmpDirs.push(d);
  return d;
}

function member(
  partial: Partial<DbClusterMember> & { host: string; id?: string },
): DbClusterMember {
  return {
    id: partial.id ?? partial.host,
    role: partial.role ?? 'node',
    host: partial.host,
    port: partial.port ?? 3306,
    access: partial.access ?? 'local',
    applyStatus: 'none',
  };
}

describe('planDbCluster router', () => {
  it('routes each known kind to a successful dry-run plan', () => {
    const dir = tmp();
    const db = new JsonStore(join(dir, 'db.json'));

    const galera = createDbCluster(db, {
      name: 'g',
      engine: 'mariadb',
      kind: 'mariadb-galera',
      members: [
        { host: '10.1.0.1', access: 'local' },
        { host: '10.1.0.2', access: 'ssh' },
      ],
    });
    expect(planDbCluster(galera).ok).toBe(true);
    expect(planDbCluster(galera).kind).toBe('mariadb-galera');

    const mysql = createDbCluster(db, {
      name: 'm',
      engine: 'mysql',
      kind: 'mysql-replica',
      members: [
        { host: '10.1.1.1', access: 'local' },
        { host: '10.1.1.2', access: 'ssh' },
      ],
    });
    expect(planDbCluster(mysql).ok).toBe(true);

    const pg = createDbCluster(db, {
      name: 'p',
      engine: 'postgres',
      kind: 'postgres-replica',
      members: [
        { host: '10.1.2.1', access: 'local' },
        { host: '10.1.2.2', access: 'ssh' },
      ],
    });
    expect(planDbCluster(pg).ok).toBe(true);

    const redis = createDbCluster(db, {
      name: 'r',
      engine: 'redis',
      kind: 'redis-replica',
      members: [
        { host: '10.1.3.1', access: 'local' },
        { host: '10.1.3.2', access: 'ssh' },
      ],
    });
    expect(planDbCluster(redis).ok).toBe(true);

    const sentinel = createDbCluster(db, {
      name: 's',
      engine: 'redis',
      kind: 'redis-sentinel',
      members: [
        { host: '10.1.4.1', role: 'master', access: 'local' },
        { host: '10.1.4.2', role: 'replica', access: 'ssh' },
        { host: '10.1.4.3', role: 'sentinel', access: 'ssh' },
      ],
    });
    expect(planDbCluster(sentinel).ok).toBe(true);
    expect(planDbCluster(sentinel).kind).toBe('redis-sentinel');
  });

  it('returns failed plan shell for mismatched kind/engine combinations', () => {
    const bad: DbCluster = {
      id: 'bad-1',
      name: 'bad',
      engine: 'mysql',
      kind: 'mariadb-galera',
      status: 'draft',
      members: [member({ host: '10.9.9.1' })],
      params: {},
      notes: [],
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    };
    const plan = planDbCluster(bad);
    expect(plan.ok).toBe(false);
    expect(plan.dryRun).toBe(true);
    expect(plan.requiresExecute).toBe(true);
    expect(plan.requiresRoot).toBe(true);
    expect(plan.steps).toHaveLength(0);
  });
});

describe('planAndMaterializeDbCluster', () => {
  it('writes artifacts and marks planned when plan ok', () => {
    const dir = tmp();
    const db = new JsonStore(join(dir, 'db.json'));
    const c = createDbCluster(db, {
      name: 'mat',
      engine: 'postgres',
      kind: 'postgres-replica',
      members: [
        { host: '10.2.0.1', access: 'local' },
        { host: '10.2.0.2', access: 'ssh' },
      ],
    });
    const { plan, cluster } = planAndMaterializeDbCluster({
      db,
      dataDir: dir,
      clusterId: c.id,
    });
    expect(plan.ok).toBe(true);
    expect(cluster.status).toBe('planned');
    expect(cluster.artifactDir).toBe(join(dir, 'clusters', c.id));
    const art = join(dir, 'clusters', c.id);
    expect(existsSync(join(art, 'plan.md'))).toBe(true);
    expect(existsSync(join(art, 'conf', '99-ysk-postgres-primary.conf'))).toBe(true);
    const meta = JSON.parse(readFileSync(join(art, 'cluster.json'), 'utf8')) as {
      status: string;
      id: string;
    };
    expect(meta.id).toBe(c.id);
    expect(meta.status).toBe('planned');
  });

  it('skips writing files when writeArtifacts is false but still marks planned', () => {
    const dir = tmp();
    const db = new JsonStore(join(dir, 'db.json'));
    const c = createDbCluster(db, {
      name: 'nowrite',
      engine: 'redis',
      kind: 'redis-replica',
      members: [
        { host: '10.3.0.1', access: 'local' },
        { host: '10.3.0.2', access: 'ssh' },
      ],
    });
    const { plan, cluster } = planAndMaterializeDbCluster({
      db,
      dataDir: dir,
      clusterId: c.id,
      writeArtifacts: false,
    });
    expect(plan.ok).toBe(true);
    expect(cluster.status).toBe('planned');
    expect(existsSync(join(dir, 'clusters', c.id, 'plan.md'))).toBe(false);
  });

  it('does not write artifacts or flip status when plan fails', () => {
    const dir = tmp();
    const db = new JsonStore(join(dir, 'db.json'));
    // Create valid cluster then force engine mismatch via direct update is hard;
    // use create then plan path with a synthetic bad cluster by patching store settings.
    const c = createDbCluster(db, {
      name: 'fail-plan',
      engine: 'mysql',
      kind: 'mysql-replica',
      members: [
        { host: '10.4.0.1', access: 'local' },
        { host: '10.4.0.2', access: 'ssh' },
      ],
    });
    // Corrupt engine so planMysqlReplica fails while registry still has the id
    const raw = JSON.parse(db.snapshot.settings['db_clusters'] ?? '[]') as DbCluster[];
    const idx = raw.findIndex((x) => x.id === c.id);
    raw[idx] = { ...raw[idx]!, engine: 'postgres' };
    db.snapshot.settings['db_clusters'] = JSON.stringify(raw);
    db.persist();

    const { plan, cluster } = planAndMaterializeDbCluster({
      db,
      dataDir: dir,
      clusterId: c.id,
    });
    expect(plan.ok).toBe(false);
    expect(cluster.status).toBe('draft');
    expect(existsSync(join(dir, 'clusters', c.id, 'plan.md'))).toBe(false);
  });
});
