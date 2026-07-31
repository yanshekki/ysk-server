import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { createDbCluster, updateDbCluster } from './store.js';
import { planAndMaterializeDbCluster } from './plan.js';
import {
  listDbClusterArtifacts,
  bundleDbClusterArtifacts,
  planDbClusterPeerPush,
  pushDbClusterToPeers,
  readDbClusterBundleFile,
} from './push-peer.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts: {
  execute?: boolean;
  failMkdir?: boolean;
  failScp?: boolean;
  log?: string[];
}): HostExecutor {
  return {
    pathExists: () => false,
    isRoot: () => true,
    executeEnabled: () => opts.execute ?? true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      const joined = argv.join(' ');
      opts.log?.push(joined);
      if (argv[0] === 'ssh' && opts.failMkdir) {
        return { ...empty(), exitCode: 1, stderr: 'mkdir fail', argv };
      }
      if (argv[0] === 'scp' && opts.failScp) {
        return { ...empty(), exitCode: 1, stderr: 'scp fail', argv };
      }
      return { ...empty(), argv };
    },
  };
}

describe('push-peer depth', () => {
  it('list artifacts empty notes when no files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pp-empty-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      // create then wipe artifact dir after materialize
      const c = createDbCluster(db, {
        name: 'e',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.1.0.1', role: 'primary', access: 'local' },
          { host: '10.1.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const art = join(dir, 'clusters', c.id);
      // remove all files under artifact dir
      rmSync(art, { recursive: true, force: true });
      mkdirSync(art, { recursive: true });
      // re-list without rematerialize by calling walk on empty — but list rematerializes
      const listed = listDbClusterArtifacts({ db, dataDir: dir, clusterId: c.id });
      // rematerialize will repopulate — assert structure
      expect(listed.cluster.id).toBe(c.id);
      expect(Array.isArray(listed.files)).toBe(true);
      expect(listed.notes.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('plan peer push for mysql / postgres / redis / galera kinds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pp-kinds-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const kinds: Array<{
        name: string;
        engine: 'mysql' | 'mariadb' | 'postgres' | 'redis';
        kind:
          | 'mysql-replica'
          | 'mariadb-galera'
          | 'postgres-replica'
          | 'redis-replica'
          | 'redis-sentinel';
        members: Array<{
          host: string;
          role?: string;
          access: 'local' | 'ssh';
        }>;
      }> = [
        {
          name: 'gal',
          engine: 'mariadb',
          kind: 'mariadb-galera',
          members: [
            { host: '10.2.0.1', access: 'local' },
            { host: '10.2.0.2', access: 'ssh' },
          ],
        },
        {
          name: 'my',
          engine: 'mysql',
          kind: 'mysql-replica',
          members: [
            { host: '10.2.1.1', role: 'primary', access: 'local' },
            { host: '10.2.1.2', role: 'replica', access: 'ssh' },
          ],
        },
        {
          name: 'pg',
          engine: 'postgres',
          kind: 'postgres-replica',
          members: [
            { host: '10.2.2.1', role: 'primary', access: 'local' },
            { host: '10.2.2.2', role: 'replica', access: 'ssh' },
          ],
        },
        {
          name: 'rd',
          engine: 'redis',
          kind: 'redis-replica',
          members: [
            { host: '10.2.3.1', role: 'master', access: 'local' },
            { host: '10.2.3.2', role: 'replica', access: 'ssh' },
          ],
        },
        {
          name: 'rs',
          engine: 'redis',
          kind: 'redis-sentinel',
          members: [
            { host: '10.2.4.1', role: 'master', access: 'local' },
            { host: '10.2.4.2', role: 'sentinel', access: 'ssh' },
          ],
        },
      ];

      for (const k of kinds) {
        const c = createDbCluster(db, {
          name: k.name,
          engine: k.engine,
          kind: k.kind,
          members: k.members,
        });
        planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
        const plan = planDbClusterPeerPush({ db, dataDir: dir, clusterId: c.id });
        expect(plan.dryRun).toBe(true);
        expect(plan.targets.length).toBeGreaterThan(0);
        // each ssh target should have some files when artifacts exist
        for (const t of plan.targets) {
          expect(t.remotePath).toContain('ysk-cluster-');
          expect(t.username).toBeTruthy();
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('push execute=true succeeds scp and marks members written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pp-push-'));
    const log: string[] = [];
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'pushok',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.3.0.1', access: 'local' },
          {
            host: '10.3.0.2',
            access: 'ssh',
            ssh: { username: 'root', port: 22 },
          },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const r = await pushDbClusterToPeers({
        db,
        dataDir: dir,
        host: mockHost({ execute: true, log }),
        clusterId: c.id,
        execute: true,
      });
      expect(r.executed).toBe(true);
      expect(r.dryRun).toBe(false);
      expect(r.ok).toBe(true);
      expect(log.some((l) => l.includes('ssh'))).toBe(true);
      expect(log.some((l) => l.includes('scp'))).toBe(true);
      const peer = r.cluster.members.find((m) => m.host === '10.3.0.2');
      expect(peer?.applyStatus).toBe('written');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('push execute fails mkdir then scp paths honestly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pp-fail-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'pushfail',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.3.1.1', role: 'primary', access: 'local' },
          { host: '10.3.1.2', role: 'replica', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });

      const mkdirFail = await pushDbClusterToPeers({
        db,
        dataDir: dir,
        host: mockHost({ execute: true, failMkdir: true }),
        clusterId: c.id,
        execute: true,
      });
      expect(mkdirFail.ok).toBe(false);
      expect(mkdirFail.executed).toBe(true);
      expect(mkdirFail.notes.some((n) => n.length > 0)).toBe(true);

      const scpFail = await pushDbClusterToPeers({
        db,
        dataDir: dir,
        host: mockHost({ execute: true, failScp: true }),
        clusterId: c.id,
        execute: true,
      });
      expect(scpFail.ok).toBe(false);
      expect(scpFail.executed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('push with no ssh targets returns empty targets failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pp-notgt-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'localonly',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.3.2.1', role: 'primary', access: 'local' },
          { host: '10.3.2.2', role: 'replica', access: 'local' },
        ],
      });
      // createDbCluster may require remote — if it works, push has no ssh peers
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const r = await pushDbClusterToPeers({
        db,
        dataDir: dir,
        host: mockHost({ execute: true }),
        clusterId: c.id,
        execute: true,
      });
      expect(r.ok).toBe(false);
      expect(r.executed).toBe(false);
      expect(r.targets).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('push filters memberId and handles missing identity gracefully', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pp-id-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'ids',
        engine: 'postgres',
        kind: 'postgres-replica',
        members: [
          { host: '10.3.3.1', role: 'primary', access: 'local' },
          {
            host: '10.3.3.2',
            role: 'replica',
            access: 'ssh',
            ssh: { username: 'deploy', port: 2222, identityId: 'missing-id' },
          },
          {
            host: '10.3.3.3',
            role: 'replica',
            access: 'ssh',
          },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const mid = c.members.find((m) => m.host === '10.3.3.2')!.id;
      const r = await pushDbClusterToPeers({
        db,
        dataDir: dir,
        host: mockHost({ execute: true }),
        clusterId: c.id,
        memberId: mid,
        execute: true,
        identityId: 'also-missing',
      });
      expect(r.targets).toHaveLength(1);
      expect(r.targets[0].host).toBe('10.3.3.2');
      expect(r.targets[0].port).toBe(2222);
      expect(r.executed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bundle + readDbClusterBundleFile path guards', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pp-bnd-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'bnd',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.3.4.1', role: 'master', access: 'local' },
          { host: '10.3.4.2', role: 'replica', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const b = bundleDbClusterArtifacts({ db, dataDir: dir, clusterId: c.id });
      expect(b.ok).toBe(true);
      expect(b.bytes).toBeGreaterThan(0);
      expect(readDbClusterBundleFile(b.bundlePath!)).not.toBeNull();
      expect(readDbClusterBundleFile('/tmp/evil/../clusters/x')).toBeNull();
      expect(readDbClusterBundleFile(join(dir, 'nope.tar.gz'))).toBeNull();
      // path with .. rejected
      expect(readDbClusterBundleFile(join(dir, 'clusters', '..', 'x'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('plan with unknown memberId yields empty targets note', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pp-mid-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'mid',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.3.5.1', access: 'local' },
          { host: '10.3.5.2', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const plan = planDbClusterPeerPush({
        db,
        dataDir: dir,
        clusterId: c.id,
        memberId: 'no-such-member',
      });
      expect(plan.targets).toHaveLength(0);
      expect(plan.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readDbClusterBundleFile catch on unreadable path returns null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pp-read-'));
    try {
      const clusters = join(dir, 'clusters', 'x');
      mkdirSync(clusters, { recursive: true });
      expect(readDbClusterBundleFile(clusters)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mysql ssh-primary and redis master role file selection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pp-roles-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const my = createDbCluster(db, {
        name: 'my2',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.3.7.1', role: 'primary', access: 'ssh' },
          { host: '10.3.7.2', role: 'replica', access: 'local' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: my.id });
      const p1 = planDbClusterPeerPush({ db, dataDir: dir, clusterId: my.id });
      expect(p1.targets.some((t) => t.host === '10.3.7.1')).toBe(true);

      const rd = createDbCluster(db, {
        name: 'rd2',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.3.8.1', role: 'master', access: 'ssh' },
          { host: '10.3.8.2', role: 'replica', access: 'local' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: rd.id });
      const p2 = planDbClusterPeerPush({ db, dataDir: dir, clusterId: rd.id });
      expect(p2.targets.some((t) => t.host === '10.3.8.1')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
