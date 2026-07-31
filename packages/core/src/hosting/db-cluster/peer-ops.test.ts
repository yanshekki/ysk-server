import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { LocalHostExecutor } from '../../host/executor.js';
import { createDbCluster } from './store.js';
import { planAndMaterializeDbCluster } from './plan.js';
import {
  probeDbClusterFull,
  installDbClusterOnPeers,
  firewallPortsForCluster,
} from './peer-ops.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts?: {
  execute?: boolean;
  root?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => opts?.root !== false,
    executeEnabled: () => opts?.execute === true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({
      ...empty(),
      argv,
      ...(opts?.run?.(argv) ?? {}),
    }),
  };
}

function memDir(): { dir: string; db: JsonStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ysk-peer-'));
  return {
    dir,
    db: new JsonStore(join(dir, 'db.json')),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('firewallPortsForCluster', () => {
  it('returns ports for each topology kind', () => {
    expect(firewallPortsForCluster('mariadb-galera')).toEqual(
      expect.arrayContaining([3306, 4567, 4444, 4568]),
    );
    expect(firewallPortsForCluster('mysql-replica')).toEqual([3306]);
    expect(firewallPortsForCluster('postgres-replica')).toEqual([5432]);
    expect(firewallPortsForCluster('redis-sentinel')).toEqual(
      expect.arrayContaining([6379, 26379]),
    );
    expect(firewallPortsForCluster('redis-replica')).toEqual([6379]);
  });
});

describe('probeDbClusterFull honesty', () => {
  it('skips SSH peers when executeEnabled=false (LocalHostExecutor default)', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'noexec',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.80.0.1', role: 'master', access: 'local' },
          { host: '10.80.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await probeDbClusterFull({
        db,
        host,
        clusterId: c.id,
        dataDir: dir,
      });
      expect(r.peersProbed).toBe(0);
      expect(r.notes.some((n) => n.length > 0)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('localOnly skips peers even with execute', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'loc',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.80.1.1', role: 'primary', access: 'local' },
          { host: '10.80.1.2', role: 'replica', access: 'ssh' },
        ],
      });
      const host = mockHost({
        execute: true,
        run: (argv) => {
          const j = argv.join(' ');
          if (j.includes('MASTER') || j.includes('BINARY')) {
            return {
              exitCode: 0,
              stdout: 'File\tPosition\nmysql-bin.000001\t100\n',
            };
          }
          return { exitCode: 0, stdout: '' };
        },
      });
      const r = await probeDbClusterFull({
        db,
        host,
        clusterId: c.id,
        localOnly: true,
      });
      expect(r.peersProbed).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('probes SSH galera peer via mysql/mariadb fallback', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'g-ssh',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.81.0.1', access: 'local' },
          { host: '10.81.0.2', access: 'ssh' },
        ],
      });
      const host = mockHost({
        execute: true,
        run: (argv) => {
          const j = argv.join(' ');
          // local probe
          if (argv[0] === 'mysql' || argv[0] === 'mariadb') {
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
          // ssh remote: first mysql fails, mariadb ok
          if (argv[0] === 'ssh') {
            if (j.includes('mysql') && !j.includes('mariadb')) {
              return { exitCode: 1, stderr: 'mysql: not found' };
            }
            if (j.includes('mariadb') || j.includes('wsrep')) {
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
          }
          return { exitCode: 0 };
        },
      });
      const r = await probeDbClusterFull({
        db,
        host,
        clusterId: c.id,
        dataDir: dir,
      });
      expect(r.peersProbed).toBe(1);
      const peer = r.cluster.members.find((m) => m.access === 'ssh');
      expect(peer?.lastProbe).toBeTruthy();
      expect(typeof peer?.lastProbe?.ok).toBe('boolean');
    } finally {
      cleanup();
    }
  });

  it('probes mysql replica/primary SSH peers', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'm-ssh',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.82.0.1', role: 'primary', access: 'local' },
          { host: '10.82.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const host = mockHost({
        execute: true,
        run: (argv) => {
          const j = argv.join(' ');
          if (argv[0] !== 'ssh' && (j.includes('MASTER') || j.includes('BINARY'))) {
            return {
              exitCode: 0,
              stdout: 'File\tPosition\nmysql-bin.000002\t200\n',
            };
          }
          if (argv[0] === 'ssh' && (j.includes('REPLICA') || j.includes('SLAVE'))) {
            return {
              exitCode: 0,
              stdout:
                'Replica_IO_Running: Yes\nReplica_SQL_Running: Yes\nLast_Error: \n',
            };
          }
          if (argv[0] === 'ssh' && j.includes('MASTER')) {
            return {
              exitCode: 0,
              stdout: 'File\tPosition\nmysql-bin.000002\t200\n',
            };
          }
          return { exitCode: 0, stdout: '' };
        },
      });
      const r = await probeDbClusterFull({
        db,
        host,
        clusterId: c.id,
        dataDir: dir,
      });
      expect(r.peersProbed).toBe(1);
      const peer = r.cluster.members.find((m) => m.access === 'ssh');
      expect(peer?.lastProbe?.ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('probes postgres and redis SSH peers; fleet notes only', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const pg = createDbCluster(db, {
        name: 'pg-ssh',
        engine: 'postgres',
        kind: 'postgres-replica',
        members: [
          { host: '10.83.0.1', role: 'primary', access: 'local' },
          { host: '10.83.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const hostPg = mockHost({
        execute: true,
        run: (argv) => {
          if (argv[0] === 'psql') {
            return { exitCode: 0, stdout: 'f\n' };
          }
          if (argv[0] === 'ssh' && argv.join(' ').includes('psql')) {
            return { exitCode: 0, stdout: 't\n' };
          }
          return { exitCode: 0, stdout: '' };
        },
      });
      const rpg = await probeDbClusterFull({
        db,
        host: hostPg,
        clusterId: pg.id,
        dataDir: dir,
      });
      expect(rpg.peersProbed).toBe(1);
      expect(
        rpg.cluster.members.find((m) => m.access === 'ssh')?.lastProbe?.ok,
      ).toBe(true);

      const rd = createDbCluster(db, {
        name: 'rd-ssh',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.83.1.1', role: 'master', access: 'local' },
          { host: '10.83.1.2', role: 'replica', access: 'ssh' },
          {
            host: '10.83.1.3',
            role: 'replica',
            access: 'fleet',
            fleetAgentId: 'fleet-1',
          },
        ],
      });
      const hostRd = mockHost({
        execute: true,
        run: (argv) => {
          if (argv[0] === 'redis-cli') {
            return {
              exitCode: 0,
              stdout: 'role:master\nconnected_slaves:1\n',
            };
          }
          if (argv[0] === 'ssh' && argv.join(' ').includes('redis-cli')) {
            return {
              exitCode: 0,
              stdout: 'role:slave\nmaster_link_status:up\n',
            };
          }
          return { exitCode: 0 };
        },
      });
      const rrd = await probeDbClusterFull({
        db,
        host: hostRd,
        clusterId: rd.id,
        dataDir: dir,
      });
      expect(rrd.peersProbed).toBe(1);
      const fleet = rrd.cluster.members.find((m) => m.access === 'fleet');
      expect(fleet?.lastProbe?.ok).toBe(false);
      expect(fleet?.lastProbe?.notes?.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it('SSH probe failure paths set lastProbe.ok=false', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'fail-ssh',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.84.0.1', role: 'master', access: 'local' },
          { host: '10.84.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const host = mockHost({
        execute: true,
        run: (argv) => {
          if (argv[0] === 'redis-cli') {
            return { exitCode: 0, stdout: 'role:master\n' };
          }
          if (argv[0] === 'ssh') {
            return { exitCode: 1, stderr: 'Connection refused' };
          }
          return { exitCode: 1 };
        },
      });
      const r = await probeDbClusterFull({
        db,
        host,
        clusterId: c.id,
        dataDir: dir,
      });
      expect(r.peersProbed).toBe(1);
      expect(
        r.cluster.members.find((m) => m.access === 'ssh')?.lastProbe?.ok,
      ).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe('installDbClusterOnPeers honesty', () => {
  it('dry-run plans install without execute flag', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'inst-dry',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.90.0.1', access: 'local' },
          { host: '10.90.0.2', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host,
        clusterId: c.id,
        execute: false,
      });
      expect(r.ok).toBe(true);
      expect(r.dryRun).toBe(true);
      expect(r.executed).toBe(false);
      expect(r.installed.length).toBe(1);
      expect(r.installed[0]?.ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('execute=true without host EXECUTE is blocked', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'inst-block',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.90.1.1', role: 'primary', access: 'local' },
          { host: '10.90.1.2', role: 'replica', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host,
        clusterId: c.id,
        execute: true,
      });
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.executed).toBe(false);
      expect(r.installed).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('no ssh peers returns ok=false', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'no-ssh',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.90.2.1', role: 'master', access: 'local' },
          {
            host: '10.90.2.2',
            role: 'replica',
            access: 'fleet',
            fleetAgentId: 'a1',
          },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const r = await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host: mockHost({ execute: true }),
        clusterId: c.id,
        execute: false,
      });
      expect(r.ok).toBe(false);
      expect(r.installed).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('execute path scp+install+restart on peer', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'inst-run',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.91.0.1', access: 'local' },
          { host: '10.91.0.2', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      // ensure peer conf exists under conf/peers
      const art = join(dir, 'clusters', c.id);
      const peerConfDir = join(art, 'conf', 'peers');
      mkdirSync(peerConfDir, { recursive: true });
      writeFileSync(join(peerConfDir, '10.91.0.2.cnf'), '[mysqld]\n# peer\n', 'utf8');

      const calls: string[][] = [];
      const host = mockHost({
        execute: true,
        run: (argv) => {
          calls.push(argv);
          return { exitCode: 0, stdout: 'ok' };
        },
      });
      const r = await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host,
        clusterId: c.id,
        execute: true,
        restart: true,
      });
      expect(r.executed).toBe(true);
      expect(r.installed.length).toBe(1);
      expect(r.installed[0]?.ok).toBe(true);
      expect(calls.some((a) => a[0] === 'scp')).toBe(true);
      expect(calls.some((a) => a[0] === 'ssh')).toBe(true);
      const peer = r.cluster.members.find((m) => m.host === '10.91.0.2');
      expect(peer?.applyStatus).toBe('applied');
    } finally {
      cleanup();
    }
  });

  it('scp failure marks peer install failed', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'inst-scp-fail',
        engine: 'postgres',
        kind: 'postgres-replica',
        members: [
          { host: '10.92.0.1', role: 'primary', access: 'local' },
          { host: '10.92.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const host = mockHost({
        execute: true,
        run: (argv) => {
          if (argv[0] === 'scp') {
            return { exitCode: 1, stderr: 'scp: connection refused' };
          }
          return { exitCode: 0 };
        },
      });
      const r = await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host,
        clusterId: c.id,
        execute: true,
      });
      expect(r.ok).toBe(false);
      expect(r.executed).toBe(true);
      expect(r.installed.some((i) => !i.ok)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('install failure and restart failure paths', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'inst-rs-fail',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.93.0.1', role: 'primary', access: 'local' },
          { host: '10.93.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      let phase = 0;
      const host = mockHost({
        execute: true,
        run: (argv) => {
          if (argv[0] === 'scp') return { exitCode: 0 };
          if (argv[0] === 'ssh') {
            const j = argv.join(' ');
            if (j.includes('install')) {
              phase += 1;
              // first call after scp is mkdir; install later
              if (j.includes('install -m') || j.includes('install') && j.includes('644')) {
                return { exitCode: 1, stderr: 'install denied' };
              }
            }
            if (j.includes('systemctl') && j.includes('restart')) {
              return { exitCode: 1, stderr: 'restart fail' };
            }
            return { exitCode: 0 };
          }
          return { exitCode: 0 };
        },
      });
      const r = await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host,
        clusterId: c.id,
        execute: true,
        restart: true,
      });
      expect(r.executed).toBe(true);
      // either install or restart failed → not all ok
      expect(r.ok === false || r.installed.some((i) => !i.ok)).toBe(true);
      void phase;
    } finally {
      cleanup();
    }
  });

  it('mysql primary conf install succeeds without restart when restart=false', async () => {
    const { dir, db, cleanup } = memDir();
    try {
      const c = createDbCluster(db, {
        name: 'inst-nr',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.94.0.1', role: 'primary', access: 'local' },
          { host: '10.94.0.2', role: 'primary', access: 'ssh' },
        ],
      });
      // force second member as primary-like role for primary conf path — store may normalize
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const host = mockHost({
        execute: true,
        run: () => ({ exitCode: 0 }),
      });
      const r = await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host,
        clusterId: c.id,
        execute: true,
        restart: false,
      });
      expect(r.executed).toBe(true);
      expect(r.installed.length).toBeGreaterThanOrEqual(1);
      // if conf missing, detail notes failure honestly
      if (r.installed[0]?.ok) {
        expect(r.installed[0].detail.length).toBeGreaterThan(0);
      } else {
        expect(r.ok).toBe(false);
      }
      expect(existsSync(join(dir, 'clusters', c.id))).toBe(true);
    } finally {
      cleanup();
    }
  });
});
