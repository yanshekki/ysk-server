import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonStore } from '../../db/store.js';
import {
  createDbCluster,
  deleteDbCluster,
  getDbCluster,
  listDbClusters,
} from './store.js';
import { planAndMaterializeDbCluster, planDbCluster } from './plan.js';
import { galeraAddressList, planMariadbGalera, renderGaleraCnf } from './plan-mariadb-galera.js';
import { evaluateGaleraHealth, parseWsrepStatus } from './probe.js';
import { applyDbClusterLocal } from './apply-local.js';
import type { HostExecutor } from '../../host/executor.js';

function memDb(): JsonStore {
  const dir = mkdtempSync(join(tmpdir(), 'ysk-dbc-'));
  return new JsonStore(join(dir, 'db.json'));
}

describe('db-cluster store', () => {
  it('creates and lists galera cluster', () => {
    const db = memDb();
    const c = createDbCluster(db, {
      name: 'g1',
      engine: 'mariadb',
      kind: 'mariadb-galera',
      members: [
        { host: '10.0.0.1', role: 'node', access: 'local' },
        { host: '10.0.0.2', role: 'node', access: 'ssh' },
      ],
    });
    expect(c.status).toBe('draft');
    expect(c.members).toHaveLength(2);
    expect(listDbClusters(db, 'mariadb')).toHaveLength(1);
    expect(getDbCluster(db, c.id).name).toBe('g1');
  });

  it('rejects demo TEST-NET host', () => {
    const db = memDb();
    expect(() =>
      createDbCluster(db, {
        name: 'bad',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [{ host: '203.0.113.10', access: 'local' }],
      }),
    ).toThrow(/真實節點/);
  });

  it('deletes cluster registry only', () => {
    const db = memDb();
    const c = createDbCluster(db, {
      name: 'x',
      engine: 'mariadb',
      kind: 'mariadb-galera',
      members: [
        { host: '10.1.0.1', access: 'local' },
        { host: '10.1.0.2', access: 'ssh' },
      ],
    });
    expect(deleteDbCluster(db, c.id)).toBe(true);
    expect(listDbClusters(db)).toHaveLength(0);
  });
});

describe('mariadb galera plan', () => {
  it('renders conf with gcomm list', () => {
    const db = memDb();
    const c = createDbCluster(db, {
      name: 'lab',
      engine: 'mariadb',
      kind: 'mariadb-galera',
      members: [
        { host: '192.168.1.10', role: 'node', access: 'local' },
        { host: '192.168.1.11', role: 'node', access: 'ssh' },
      ],
      params: { clusterName: 'ysk-lab', sstMethod: 'rsync' },
    });
    expect(galeraAddressList(c)).toContain('192.168.1.10:4567');
    const cnf = renderGaleraCnf(c, '192.168.1.10');
    expect(cnf).toContain('wsrep_on=ON');
    expect(cnf).toContain('gcomm://');
    expect(cnf).toContain('rsync');
    const plan = planMariadbGalera(c);
    expect(plan.ok).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(2);
    expect(plan.files.some((f) => f.relativePath.endsWith('.cnf'))).toBe(true);
  });

  it('materializes artifacts under dataDir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dbc-art-'));
    const db = new JsonStore(join(dir, 'db.json'));
    const c = createDbCluster(db, {
      name: 'art',
      engine: 'mariadb',
      kind: 'mariadb-galera',
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
    expect(existsSync(join(dir, 'clusters', c.id, 'conf', '99-ysk-galera.cnf'))).toBe(true);
    expect(readFileSync(join(dir, 'clusters', c.id, 'plan.md'), 'utf8')).toMatch(/Galera/);
  });

  it('stub planner for other kinds', () => {
    const db = memDb();
    const c = createDbCluster(db, {
      name: 'pg',
      engine: 'postgres',
      kind: 'postgres-replica',
      members: [
        { host: '10.3.0.1', access: 'local' },
        { host: '10.3.0.2', access: 'ssh' },
      ],
    });
    const plan = planDbCluster(c);
    expect(plan.ok).toBe(false);
    expect(plan.notes.join(' ')).toMatch(/尚未實作/);
  });
});

describe('galera probe parse', () => {
  it('parses wsrep status lines', () => {
    const out = [
      'wsrep_cluster_size\t3',
      'wsrep_ready\tON',
      'wsrep_connected\tON',
      'wsrep_local_state_comment\tSynced',
    ].join('\n');
    const facts = parseWsrepStatus(out);
    expect(facts.wsrep_cluster_size).toBe('3');
    expect(facts.wsrep_ready).toBe('ON');
    const h = evaluateGaleraHealth(facts, 3);
    expect(h.ok).toBe(true);
  });

  it('degraded when size too small', () => {
    const facts = parseWsrepStatus('wsrep_cluster_size\t1\nwsrep_ready\tON\nwsrep_connected\tON\n');
    const h = evaluateGaleraHealth(facts, 3);
    expect(h.ok).toBe(false);
  });
});

describe('apply local dry-run', () => {
  it('writes artifacts and marks partial without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dbc-apply-'));
    const db = new JsonStore(join(dir, 'db.json'));
    const c = createDbCluster(db, {
      name: 'apply1',
      engine: 'mariadb',
      kind: 'mariadb-galera',
      members: [
        { host: '10.4.0.1', access: 'local' },
        { host: '10.4.0.2', access: 'ssh' },
      ],
    });
    const host: HostExecutor = {
      executeEnabled: () => false,
      isRoot: () => false,
      pathExists: () => false,
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv: [],
        dryRun: false,
      }),
      runCommand: async (argv) => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
      }),
    };
    const r = await applyDbClusterLocal({
      db,
      dataDir: dir,
      host,
      clusterId: c.id,
      execute: false,
    });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.cluster.status).toBe('partial');
    expect(r.cluster.members.find((m) => m.access === 'local')?.applyStatus).toBe(
      'written',
    );
    expect(existsSync(join(dir, 'clusters', c.id, 'conf', '99-ysk-galera.cnf'))).toBe(
      true,
    );
  });

  it('blocked when execute without YSK_EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dbc-block-'));
    const db = new JsonStore(join(dir, 'db.json'));
    const c = createDbCluster(db, {
      name: 'block1',
      engine: 'mariadb',
      kind: 'mariadb-galera',
      members: [
        { host: '10.5.0.1', access: 'local' },
        { host: '10.5.0.2', access: 'ssh' },
      ],
    });
    const host: HostExecutor = {
      executeEnabled: () => false,
      isRoot: () => true,
      pathExists: () => true,
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv: [],
        dryRun: false,
      }),
      runCommand: async (argv) => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
      }),
    };
    const r = await applyDbClusterLocal({
      db,
      dataDir: dir,
      host,
      clusterId: c.id,
      execute: true,
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });
});
