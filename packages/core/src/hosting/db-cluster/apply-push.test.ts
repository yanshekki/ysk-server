import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { createDbCluster } from './store.js';
import { planAndMaterializeDbCluster } from './plan.js';
import {
  applyDbClusterLocal,
  readLocalGaleraConfSnippet,
} from './apply-local.js';
import {
  planDbClusterPeerPush,
  pushDbClusterToPeers,
  listDbClusterArtifacts,
  readDbClusterBundleFile,
  bundleDbClusterArtifacts,
} from './push-peer.js';
import { installDbClusterOnPeers } from './peer-ops.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
}): HostExecutor {
  return {
    pathExists: () => false,
    isRoot: () => opts.root ?? false,
    executeEnabled: () => opts.execute ?? false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv }),
  };
}

describe('applyDbClusterLocal', () => {
  it('mysql-replica dry-run writes primary conf without system apply', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-apl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'mx',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.60.0.1', role: 'primary', access: 'local' },
          { host: '10.60.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({ execute: false }),
        clusterId: c.id,
        execute: false,
      });
      expect(r.ok).toBe(true);
      expect(r.dryRun).toBe(true);
      expect(r.executed).toBe(false);
      expect(r.requiresExecute).toBe(true);
      expect(r.cluster.status).toBe('planned');
      expect(
        existsSync(join(dir, 'clusters', c.id, 'conf', '99-ysk-mysql-primary.cnf')),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks execute without YSK_EXECUTE (honesty)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-apl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'block',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.61.0.1', access: 'local' },
          { host: '10.61.0.2', access: 'ssh' },
        ],
      });
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({ execute: false, root: true }),
        clusterId: c.id,
        execute: true,
      });
      expect(r.ok).toBe(false);
      expect(r.blocked === true || r.executed === false).toBe(true);
      expect(r.requiresExecute).toBe(true);
      expect(r.executed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readLocalGaleraConfSnippet returns empty when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-apl-'));
    try {
      expect(readLocalGaleraConfSnippet(dir, 'nope')).toBe('');
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'snip',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.62.0.1', access: 'local' },
          { host: '10.62.0.2', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const snip = readLocalGaleraConfSnippet(dir, c.id);
      expect(snip.length).toBeGreaterThan(0);
      expect(snip).toMatch(/wsrep|galera/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('push-peer + install peers honesty', () => {
  it('push dry-run requires execute for real push', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-push-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'p1',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.70.0.1', access: 'local' },
          { host: '10.70.0.2', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const plan = planDbClusterPeerPush({ db, dataDir: dir, clusterId: c.id });
      expect(plan.dryRun).toBe(true);
      expect(plan.targets).toHaveLength(1);

      const dry = await pushDbClusterToPeers({
        db,
        dataDir: dir,
        host: mockHost({ execute: true }),
        clusterId: c.id,
        execute: false,
      });
      expect(dry.dryRun).toBe(true);
      expect(dry.executed).toBe(false);
      expect(dry.requiresExecute).toBe(true);

      const blocked = await pushDbClusterToPeers({
        db,
        dataDir: dir,
        host: mockHost({ execute: false }),
        clusterId: c.id,
        execute: true,
      });
      expect(blocked.blocked).toBe(true);
      expect(blocked.ok).toBe(false);
      expect(blocked.executed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('install peers with no ssh peers fails honestly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-inst-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      // two locals would violate create? use fleet only remote
      const c = createDbCluster(db, {
        name: 'solo',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.71.0.1', role: 'master', access: 'local' },
          {
            host: '10.71.0.2',
            role: 'replica',
            access: 'fleet',
            fleetAgentId: 'agent-x',
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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bundle and readDbClusterBundleFile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bnd-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'b',
        engine: 'postgres',
        kind: 'postgres-replica',
        members: [
          { host: '10.72.0.1', role: 'primary', access: 'local' },
          { host: '10.72.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id });
      const listed = listDbClusterArtifacts({ db, dataDir: dir, clusterId: c.id });
      expect(listed.files.length).toBeGreaterThan(0);
      const bundled = bundleDbClusterArtifacts({ db, dataDir: dir, clusterId: c.id });
      expect(bundled.ok).toBe(true);
      expect(bundled.bundlePath).toBeTruthy();
      const buf = readDbClusterBundleFile(bundled.bundlePath!);
      expect(buf).not.toBeNull();
      expect((buf?.length ?? 0) > 0).toBe(true);
      expect(readDbClusterBundleFile(join(dir, 'missing.tar.gz'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
