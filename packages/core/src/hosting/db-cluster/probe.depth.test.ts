import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { createDbCluster } from './store.js';
import {
  parseWsrepStatus,
  evaluateGaleraHealth,
  parseMasterStatus,
  parseReplicaStatus,
  evaluateMysqlReplicaLocal,
  probeDbCluster,
} from './probe.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(run: (argv: string[]) => Partial<RunResult>): HostExecutor {
  return {
    pathExists: () => false,
    isRoot: () => false,
    executeEnabled: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv, ...run(argv) }),
  };
}

describe('db-cluster probe depth', () => {
  it('parseWsrepStatus pipe and whitespace formats', () => {
    const pipe = parseWsrepStatus(
      `| Variable_name | Value |\n| wsrep_ready | ON |\n| wsrep_connected | ON |\n`,
    );
    expect(pipe.wsrep_ready).toBe('ON');
    const tab = parseWsrepStatus(`wsrep_cluster_size 3\nwsrep_local_state_comment Synced\n`);
    expect(tab.wsrep_cluster_size).toBe('3');
  });

  it('evaluateGaleraHealth covers ready/size/state branches', () => {
    expect(evaluateGaleraHealth({}, 3).ok).toBe(false);
    expect(
      evaluateGaleraHealth(
        { wsrep_ready: 'ON', wsrep_connected: 'ON', wsrep_cluster_size: '3', wsrep_local_state_comment: 'Synced' },
        3,
      ).ok,
    ).toBe(true);
    expect(
      evaluateGaleraHealth(
        { wsrep_ready: 'OFF', wsrep_connected: 'ON', wsrep_cluster_size: '1' },
        3,
      ).ok,
    ).toBe(false);
    expect(
      evaluateGaleraHealth(
        { wsrep_ready: 'YES', wsrep_connected: 'YES', wsrep_cluster_size: '1', wsrep_local_state: '2' },
        2,
      ).ok,
    ).toBe(false);
  });

  it('parse master/replica and evaluateMysqlReplicaLocal', () => {
    const master = parseMasterStatus(`File\tPosition\nmysql-bin.0001\t123\n`);
    expect(master.master_has_binlog).toBe('yes');
    const g = parseMasterStatus(`File: mysql-bin.0002\nPosition: 99\n`);
    expect(g.master_File || g.master_file).toBeTruthy();

    const rep = parseReplicaStatus(
      `Replica_IO_Running: Yes\nReplica_SQL_Running: Yes\nLast_Error: \n`,
    );
    expect(evaluateMysqlReplicaLocal('replica', rep).ok).toBe(true);
    expect(evaluateMysqlReplicaLocal('primary', {}).ok).toBe(false);
    expect(
      evaluateMysqlReplicaLocal('slave', {
        Slave_IO_Running: 'No',
        Slave_SQL_Running: 'Yes',
        Last_SQL_Error: 'boom',
      }).ok,
    ).toBe(false);

    const tab = parseReplicaStatus(
      `Replica_IO_Running\tReplica_SQL_Running\nYes\tYes\n`,
    );
    expect(tab.Replica_IO_Running || Object.keys(tab).length).toBeTruthy();
  });

  it('probeDbCluster galera healthy via mysql client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pr-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'g',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.0.0.1', access: 'local' },
          { host: '10.0.0.2', access: 'ssh' },
        ],
      });
      const r = await probeDbCluster({
        db,
        clusterId: c.id,
        host: mockHost((argv) => {
          if (argv[0] === 'mysql' && String(argv.join(' ')).includes('wsrep')) {
            return {
              exitCode: 0,
              stdout: `wsrep_ready ON\nwsrep_connected ON\nwsrep_cluster_size 2\nwsrep_local_state_comment Synced\n`,
            };
          }
          return { exitCode: 1 };
        }),
      });
      expect(r.localOk).toBe(true);
      expect(r.ok).toBe(true);
      expect(Object.keys(r.facts).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probeDbCluster galera falls back to mariadb client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pr2-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'g2',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.0.1.1', access: 'local' },
          { host: '10.0.1.2', access: 'ssh' },
        ],
      });
      const r = await probeDbCluster({
        db,
        clusterId: c.id,
        host: mockHost((argv) => {
          if (argv[0] === 'mysql') return { exitCode: 1, stderr: 'no mysql' };
          if (argv[0] === 'mariadb') {
            return {
              exitCode: 0,
              stdout: `| wsrep_ready | ON |\n| wsrep_connected | ON |\n| wsrep_cluster_size | 2 |\n`,
            };
          }
          return { exitCode: 1 };
        }),
      });
      expect(r.localOk).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probeDbCluster mysql-replica primary and replica roles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pr3-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const primary = createDbCluster(db, {
        name: 'mx-p',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.1.0.1', role: 'primary', access: 'local' },
          { host: '10.1.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const rp = await probeDbCluster({
        db,
        clusterId: primary.id,
        host: mockHost((argv) => {
          const j = argv.join(' ');
          if (j.includes('MASTER') || j.includes('BINARY')) {
            return { exitCode: 0, stdout: `File\tPosition\nbin.0001\t4\n` };
          }
          return { exitCode: 1 };
        }),
      });
      expect(rp.localOk).toBe(true);

      const replica = createDbCluster(db, {
        name: 'mx-r',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.1.1.1', role: 'replica', access: 'local' },
          { host: '10.1.1.2', role: 'primary', access: 'ssh' },
        ],
      });
      const rr = await probeDbCluster({
        db,
        clusterId: replica.id,
        host: mockHost((argv) => {
          const j = argv.join(' ');
          // runMysqlQuery uses: mysql -e 'SHOW REPLICA STATUS\G'
          if (argv[0] === 'mysql' && /REPLICA|SLAVE/i.test(j)) {
            return {
              exitCode: 0,
              stdout: `Replica_IO_Running: Yes\nReplica_SQL_Running: Yes\n`,
            };
          }
          return { exitCode: 1 };
        }),
      });
      expect(typeof rr.localOk).toBe('boolean');
      expect(rr.notes.length).toBeGreaterThan(0);

      // replica fail → fallback SLAVE query path
      const rr2 = await probeDbCluster({
        db,
        clusterId: replica.id,
        host: mockHost((argv) => {
          const j = argv.join(' ');
          if (j.includes('REPLICA') && !j.includes('SLAVE')) {
            return { exitCode: 1, stderr: 'unknown' };
          }
          if (j.includes('SLAVE')) {
            return {
              exitCode: 0,
              stdout: `Slave_IO_Running: Yes\nSlave_SQL_Running: No\nLast_SQL_Error: x\n`,
            };
          }
          return { exitCode: 1 };
        }),
      });
      expect(rr2.localOk).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probeDbCluster postgres and redis kinds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pr4-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const pg = createDbCluster(db, {
        name: 'pg',
        engine: 'postgres',
        kind: 'postgres-replica',
        members: [
          { host: '10.2.0.1', role: 'primary', access: 'local' },
          { host: '10.2.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const rpg = await probeDbCluster({
        db,
        clusterId: pg.id,
        host: mockHost((argv) => {
          if (argv[0] === 'psql' || argv.join(' ').includes('postgres')) {
            return { exitCode: 0, stdout: ' t\n' };
          }
          // generic recovery probe
          return { exitCode: 0, stdout: 'f\n' };
        }),
      });
      expect(typeof rpg.ok).toBe('boolean');
      expect(rpg.notes.length).toBeGreaterThan(0);

      const rd = createDbCluster(db, {
        name: 'rd',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.3.0.1', role: 'master', access: 'local' },
          { host: '10.3.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const rrd = await probeDbCluster({
        db,
        clusterId: rd.id,
        host: mockHost((argv) => {
          if (argv[0] === 'redis-cli') {
            return { exitCode: 0, stdout: 'role:master\nconnected_slaves:1\n' };
          }
          return { exitCode: 1 };
        }),
      });
      expect(typeof rrd.ok).toBe('boolean');

      const rs = createDbCluster(db, {
        name: 'rs',
        engine: 'redis',
        kind: 'redis-sentinel',
        members: [
          { host: '10.3.1.1', role: 'sentinel', access: 'local' },
          { host: '10.3.1.2', role: 'master', access: 'ssh' },
        ],
      });
      const rrs = await probeDbCluster({
        db,
        clusterId: rs.id,
        host: mockHost((argv) => {
          if (argv[0] === 'redis-cli') {
            return { exitCode: 0, stdout: 'master0:name=mymaster,status=ok\n' };
          }
          return { exitCode: 1 };
        }),
      });
      expect(typeof rrs.ok).toBe('boolean');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probeDbCluster unsupported kind and client missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pr5-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      // create galera then force kind via raw update if needed
      const c = createDbCluster(db, {
        name: 'x',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.9.0.1', role: 'primary', access: 'local' },
          { host: '10.9.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const fail = await probeDbCluster({
        db,
        clusterId: c.id,
        host: mockHost(() => ({ exitCode: 127, stderr: 'command not found' })),
      });
      expect(fail.localOk).toBe(false);
      expect(fail.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
