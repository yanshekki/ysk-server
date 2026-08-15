import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { createDbCluster } from './store.js';
import {
  probeDbCluster,
  parseMasterStatus,
  parseReplicaStatus,
  evaluateGaleraHealth,
  evaluateMysqlReplicaLocal,
} from './probe.js';
import { probeDbClusterFull, firewallPortsForCluster } from './peer-ops.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(scriptOut: (argv: string[]) => Partial<RunResult>): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => true,
    executeEnabled: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv, ...scriptOut(argv) }),
  };
}

function memDir(): { dir: string; db: JsonStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ysk-probe-'));
  return {
    dir,
    db: new JsonStore(join(dir, 'db.json')),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('probe parsers', () => {
  it('parses master and replica tabular / G styles', () => {
    const master = parseMasterStatus(
      'File\tPosition\nmysql-bin.000001\t154\n',
    );
    expect(master.master_has_binlog).toBe('yes');
    expect(master.master_File || master['master_File']).toBeTruthy();

    const g = parseMasterStatus('File: mysql-bin.000002\nPosition: 999\n');
    expect(g.master_File || g.master_file).toBeTruthy();

    const rep = parseReplicaStatus(
      'Replica_IO_Running: Yes\nReplica_SQL_Running: Yes\nLast_Error: \n',
    );
    expect(rep.Replica_IO_Running).toBe('Yes');
    expect(evaluateMysqlReplicaLocal('replica', rep).ok).toBe(true);
  });

  it('galera health empty facts fail closed', () => {
    expect(evaluateGaleraHealth({}, 3).ok).toBe(false);
  });
});

describe('probeDbCluster', () => {
  it('galera healthy when wsrep synced and size matches', async () => {
    const { db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'g',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.50.0.1', access: 'local' },
          { host: '10.50.0.2', access: 'ssh' },
        ],
      });
      const host = mockHost((argv) => {
        if (argv.includes('mysql') || argv.includes('mariadb')) {
          return {
            exitCode: 0,
            stdout: [
              'wsrep_cluster_size\t2',
              'wsrep_ready\tON',
              'wsrep_connected\tON',
              'wsrep_local_state_comment\tSynced',
            ].join('\n'),
          };
        }
        return {};
      });
      const r = await probeDbCluster({ db, host, clusterId: c.id });
      expect(r.localOk).toBe(true);
      expect(r.facts.wsrep_ready).toBe('ON');
      expect(r.cluster.status === 'healthy' || r.cluster.status === 'partial').toBe(
        true,
      );
    } finally {
      cleanup();
    }
  });

  it('galera fails when mysql client errors', async () => {
    const { db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'g2',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.50.1.1', access: 'local' },
          { host: '10.50.1.2', access: 'ssh' },
        ],
      });
      const host = mockHost(() => ({
        exitCode: 1,
        stderr: 'mysql: not found',
      }));
      const r = await probeDbCluster({ db, host, clusterId: c.id });
      expect(r.localOk).toBe(false);
      expect(r.ok).toBe(false);
      expect(['degraded', 'failed']).toContain(r.cluster.status);
    } finally {
      cleanup();
    }
  });

  it('mysql primary and replica probe paths', async () => {
    const { db, cleanup } = memDir();
    try {
      const primary = createDbCluster(db, {
        name: 'mp',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.51.0.1', role: 'primary', access: 'local' },
          { host: '10.51.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const hostP = mockHost((argv) => {
        const joined = argv.join(' ');
        if (joined.includes('MASTER') || joined.includes('BINARY')) {
          return {
            exitCode: 0,
            stdout: 'File\tPosition\nmysql-bin.000003\t120\n',
          };
        }
        return { exitCode: 1 };
      });
      const rp = await probeDbCluster({ db, host: hostP, clusterId: primary.id });
      expect(rp.localOk).toBe(true);
      expect(rp.cluster.status).toBe('partial');

      // members[0] is always primary; local replica is a non-first member
      const replica = createDbCluster(db, {
        name: 'mr',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.51.1.2', role: 'primary', access: 'ssh' },
          { host: '10.51.1.1', role: 'replica', access: 'local' },
        ],
      });
      const hostR = mockHost((argv) => {
        const joined = argv.join(' ');
        if (joined.includes('REPLICA') || joined.includes('SLAVE')) {
          return {
            exitCode: 0,
            stdout: 'Replica_IO_Running: Yes\nReplica_SQL_Running: Yes\n',
          };
        }
        return { exitCode: 1 };
      });
      const rr = await probeDbCluster({ db, host: hostR, clusterId: replica.id });
      expect(rr.localOk).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('postgres and redis probe honesty', async () => {
    const { db, cleanup } = memDir();
    try {
      const pg = createDbCluster(db, {
        name: 'pg1',
        engine: 'postgres',
        kind: 'postgres-replica',
        members: [
          { host: '10.52.0.1', role: 'primary', access: 'local' },
          { host: '10.52.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const hostPg = mockHost((argv) => {
        if (argv[0] === 'runuser' || argv[0] === 'psql') {
          return { exitCode: 0, stdout: 'f\n' };
        }
        return { exitCode: 1 };
      });
      const rpg = await probeDbCluster({ db, host: hostPg, clusterId: pg.id });
      expect(rpg.localOk).toBe(true);
      expect(rpg.facts.pg_is_in_recovery).toMatch(/f|false/i);

      const rd = createDbCluster(db, {
        name: 'rd1',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.52.1.1', role: 'master', access: 'local' },
          { host: '10.52.1.2', role: 'replica', access: 'ssh' },
        ],
      });
      const hostRd = mockHost((argv) => {
        if (argv[0] === 'redis-cli') {
          return {
            exitCode: 0,
            stdout: 'role:master\nconnected_slaves:1\n',
          };
        }
        return {};
      });
      const rrd = await probeDbCluster({ db, host: hostRd, clusterId: rd.id });
      expect(rrd.localOk).toBe(true);
      expect(rrd.facts.role).toBe('master');
    } finally {
      cleanup();
    }
  });

  it('probeDbClusterFull skips peers without execute', async () => {
    const { db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'full1',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.53.0.1', role: 'master', access: 'local' },
          { host: '10.53.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const host = mockHost((argv) => {
        if (argv[0] === 'redis-cli') {
          return { exitCode: 0, stdout: 'role:master\nconnected_slaves:0\n' };
        }
        return {};
      });
      const r = await probeDbClusterFull({
        db,
        host,
        clusterId: c.id,
      });
      expect(r.peersProbed).toBe(0);
      expect(r.notes.some((n) => n.length > 0)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('firewallPortsForCluster covers kinds', () => {
    expect(firewallPortsForCluster('mariadb-galera')).toEqual(
      expect.arrayContaining([3306, 4567]),
    );
    expect(firewallPortsForCluster('mysql-replica')).toContain(3306);
    expect(firewallPortsForCluster('postgres-replica')).toEqual([5432]);
    expect(firewallPortsForCluster('redis-replica')).toContain(6379);
    expect(firewallPortsForCluster('redis-sentinel')).toEqual(
      expect.arrayContaining([6379, 26379]),
    );
  });
});
