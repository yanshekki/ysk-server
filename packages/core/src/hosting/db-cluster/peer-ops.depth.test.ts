import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { createDbCluster } from './store.js';
import { planAndMaterializeDbCluster } from './plan.js';
import {
  probeDbClusterFull,
  installDbClusterOnPeers,
  firewallPortsForCluster,
} from './peer-ops.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(run: (argv: string[]) => Partial<RunResult>, execute = true): HostExecutor {
  return {
    executeEnabled: () => execute,
    isRoot: () => true,
    pathExists: () => false,
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

describe('peer-ops depth engines', () => {
  it('firewallPortsForCluster covers all kinds', () => {
    expect(firewallPortsForCluster('mariadb-galera')).toContain(4567);
    expect(firewallPortsForCluster('mysql-replica')).toEqual([3306]);
    expect(firewallPortsForCluster('postgres-replica')).toEqual([5432]);
    expect(firewallPortsForCluster('redis-sentinel')).toContain(26379);
    expect(firewallPortsForCluster('redis-replica')).toEqual([6379]);
  });

  it('probeDbClusterFull mysql replica+primary ssh peers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-po-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'mx',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.0.0.1', role: 'primary', access: 'local' },
          { host: '10.0.0.2', role: 'replica', access: 'ssh', ssh: { username: 'root', port: 22 } },
        ],
      });
      const r = await probeDbClusterFull({
        db,
        dataDir: dir,
        clusterId: c.id,
        host: mockHost((argv) => {
          const j = argv.join(' ');
          if (argv[0] === 'mysql' && j.includes('MASTER')) {
            return { exitCode: 0, stdout: 'File\tPosition\nbin.0001\t4\n' };
          }
          if (argv[0] === 'ssh') {
            if (j.includes('REPLICA') || j.includes('SLAVE')) {
              return {
                exitCode: 0,
                stdout: 'Replica_IO_Running: Yes\nReplica_SQL_Running: Yes\n',
              };
            }
            return { exitCode: 0, stdout: '' };
          }
          return { exitCode: 1 };
        }),
      });
      expect(r.notes.length).toBeGreaterThan(0);
      expect(typeof r.localOk).toBe('boolean');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('installDbClusterOnPeers for postgres/redis/galera dry and execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-po2-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      for (const spec of [
        {
          name: 'pg',
          engine: 'postgres' as const,
          kind: 'postgres-replica' as const,
          members: [
            { host: '10.1.0.1', role: 'primary', access: 'local' as const },
            { host: '10.1.0.2', role: 'replica', access: 'ssh' as const, ssh: { username: 'root' } },
          ],
        },
        {
          name: 'rd',
          engine: 'redis' as const,
          kind: 'redis-replica' as const,
          members: [
            { host: '10.2.0.1', role: 'master', access: 'local' as const },
            { host: '10.2.0.2', role: 'replica', access: 'ssh' as const },
          ],
        },
        {
          name: 'rs',
          engine: 'redis' as const,
          kind: 'redis-sentinel' as const,
          members: [
            { host: '10.3.0.1', role: 'master', access: 'local' as const },
            { host: '10.3.0.2', role: 'sentinel', access: 'ssh' as const },
          ],
        },
        {
          name: 'ga',
          engine: 'mariadb' as const,
          kind: 'mariadb-galera' as const,
          members: [
            { host: '10.4.0.1', access: 'local' as const },
            { host: '10.4.0.2', access: 'ssh' as const },
          ],
        },
      ]) {
        const c = createDbCluster(db, spec);
        planAndMaterializeDbCluster({
          db,
          dataDir: dir,
          clusterId: c.id,
          writeArtifacts: true,
        });
        const dry = await installDbClusterOnPeers({
          db,
          dataDir: dir,
          host: mockHost(() => ({})),
          clusterId: c.id,
          execute: false,
        });
        expect(dry.dryRun).toBe(true);
        expect(dry.installed.length).toBeGreaterThan(0);

        const exec = await installDbClusterOnPeers({
          db,
          dataDir: dir,
          host: mockHost((argv) => {
            if (argv[0] === 'scp') return { exitCode: 0 };
            if (argv[0] === 'ssh') return { exitCode: 0, stdout: 'ok' };
            return {};
          }),
          clusterId: c.id,
          execute: true,
          restart: true,
        });
        expect(exec.executed).toBe(true);
        expect(exec.installed.length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('install scp fail and missing conf paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-po3-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'mx2',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.5.0.1', role: 'primary', access: 'local' },
          { host: '10.5.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id, writeArtifacts: true });
      const scpFail = await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host: mockHost((argv) =>
          argv[0] === 'scp' ? { exitCode: 1, stderr: 'scp fail' } : { exitCode: 0 },
        ),
        clusterId: c.id,
        execute: true,
      });
      expect(scpFail.ok).toBe(false);
      expect(scpFail.installed.some((i) => !i.ok)).toBe(true);

      const instFail = await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host: mockHost((argv) => {
          if (argv[0] === 'scp') return { exitCode: 0 };
          if (argv[0] === 'ssh' && argv.includes('install')) {
            return { exitCode: 1, stderr: 'install fail' };
          }
          return { exitCode: 0 };
        }),
        clusterId: c.id,
        execute: true,
        restart: false,
      });
      expect(instFail.installed.some((i) => !i.ok)).toBe(true);

      const restartFail = await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host: mockHost((argv) => {
          if (argv[0] === 'scp') return { exitCode: 0 };
          if (argv[0] === 'ssh' && argv.includes('restart')) {
            return { exitCode: 1, stderr: 'restart fail' };
          }
          return { exitCode: 0 };
        }),
        clusterId: c.id,
        execute: true,
        restart: true,
      });
      expect(restartFail.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
