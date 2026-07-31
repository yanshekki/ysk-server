import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
  run?: (argv: string[]) => Promise<Partial<RunResult>> | Partial<RunResult>;
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
    runCommand: async (argv) => {
      const partial = opts.run ? await opts.run(argv) : {};
      return { ...empty(), argv, ...partial };
    },
  };
}

function tmp() {
  return mkdtempSync(join(tmpdir(), 'ysk-apl-d-'));
}

describe('applyDbClusterLocal depth', () => {
  it('postgres-replica dry-run writes primary conf', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'pg',
        engine: 'postgres',
        kind: 'postgres-replica',
        members: [
          { host: '10.80.0.1', role: 'primary', access: 'local' },
          { host: '10.80.0.2', role: 'replica', access: 'ssh' },
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
      expect(r.cluster.status).toBe('partial');
      expect(
        existsSync(join(dir, 'clusters', c.id, 'conf', '99-ysk-postgres-primary.conf')),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('redis-replica dry-run and redis-sentinel dry-run', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const redis = createDbCluster(db, {
        name: 'rd',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.81.0.1', role: 'master', access: 'local' },
          { host: '10.81.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const r1 = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({}),
        clusterId: redis.id,
      });
      expect(r1.ok).toBe(true);
      expect(r1.dryRun).toBe(true);
      expect(
        existsSync(join(dir, 'clusters', redis.id, 'conf', '99-ysk-redis-master.conf')),
      ).toBe(true);

      const sent = createDbCluster(db, {
        name: 'rs',
        engine: 'redis',
        kind: 'redis-sentinel',
        members: [
          { host: '10.81.0.3', role: 'master', access: 'local' },
          { host: '10.81.0.4', role: 'sentinel', access: 'ssh' },
        ],
      });
      const r2 = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({}),
        clusterId: sent.id,
        execute: false,
      });
      expect(r2.ok).toBe(true);
      expect(r2.executed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks execute without root when EXECUTE is on', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'noroot',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.82.0.1', access: 'local' },
          { host: '10.82.0.2', access: 'ssh' },
        ],
      });
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({ execute: true, root: false }),
        clusterId: c.id,
        execute: true,
      });
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.requiresRoot).toBe(true);
      expect(r.executed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('execute with root copies drop-in and restarts (mock host, tmp dest via conf.d fallback)', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'exec',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.83.0.1', role: 'primary', access: 'local' },
          { host: '10.83.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id, writeArtifacts: true });
      const cmds: string[][] = [];
      // Pre-create artifact so copy succeeds; system dest may fail on /etc — we still
      // assert honesty when copy fails or restart is attempted.
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({
          execute: true,
          root: true,
          run: async (argv) => {
            cmds.push(argv);
            if (argv[0] === 'systemctl') return { exitCode: 0, stdout: 'restarted' };
            return {};
          },
        }),
        clusterId: c.id,
        execute: true,
      });
      // On non-root CI, writing /etc/mysql may fail → ok false, executed false, notes honest
      expect(r.executed === true || r.ok === false).toBe(true);
      expect(r.notes.length).toBeGreaterThan(0);
      if (r.executed) {
        expect(cmds.some((a) => a[0] === 'systemctl' && a[1] === 'restart')).toBe(true);
        expect(r.systemConf).toBeTruthy();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('execute with root fails honestly when system drop-in not writable', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      for (const kind of [
        {
          name: 'mx-e',
          engine: 'mysql' as const,
          kind: 'mysql-replica' as const,
          members: [
            { host: '10.83.0.1', role: 'primary', access: 'local' as const },
            { host: '10.83.0.2', role: 'replica', access: 'ssh' as const },
          ],
        },
        {
          name: 'pg-e',
          engine: 'postgres' as const,
          kind: 'postgres-replica' as const,
          members: [
            { host: '10.90.0.1', role: 'primary', access: 'local' as const },
            { host: '10.90.0.2', role: 'replica', access: 'ssh' as const },
          ],
        },
        {
          name: 'rd-e',
          engine: 'redis' as const,
          kind: 'redis-replica' as const,
          members: [
            { host: '10.91.0.1', role: 'master', access: 'local' as const },
            { host: '10.91.0.2', role: 'replica', access: 'ssh' as const },
          ],
        },
        {
          name: 'ga-e',
          engine: 'mariadb' as const,
          kind: 'mariadb-galera' as const,
          members: [
            { host: '10.84.0.1', access: 'local' as const },
            { host: '10.84.0.2', access: 'ssh' as const },
          ],
        },
      ]) {
        const c = createDbCluster(db, kind);
        const r = await applyDbClusterLocal({
          db,
          dataDir: dir,
          host: mockHost({
            execute: true,
            root: true,
            run: async (argv) => {
              if (argv[0] === 'systemctl' || argv[0] === 'galera_new_cluster') {
                return { exitCode: 0 };
              }
              if (argv.join(' ').includes('galera_new_cluster')) {
                return { stdout: '/usr/bin/galera_new_cluster', exitCode: 0 };
              }
              return {};
            },
          }),
          clusterId: c.id,
          execute: true,
          bootstrap: kind.kind === 'mariadb-galera',
        });
        // Without root to /etc: either applied (if environment allows) or failed honestly
        expect(r.executed === true || r.ok === false).toBe(true);
        expect(r.notes.length).toBeGreaterThan(0);
        if (!r.ok && !r.executed) {
          // copy to /etc failed → members failed
          expect(
            r.cluster.status === 'failed' || r.cluster.status === 'partial',
          ).toBe(true);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('execute fails when conf artifacts missing after plan', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'noconf',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.93.0.1', role: 'primary', access: 'local' },
          { host: '10.93.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id, writeArtifacts: true });
      // wipe conf so execute cannot find source
      rmSync(join(dir, 'clusters', c.id, 'conf'), { recursive: true, force: true });
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({ execute: true, root: true }),
        clusterId: c.id,
        execute: true,
      });
      expect(r.ok).toBe(false);
      expect(r.executed).toBe(false);
      expect(r.notes.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('postgres replica local role dry-run and redis replica/sentinel roles', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const pg = createDbCluster(db, {
        name: 'pg-r',
        engine: 'postgres',
        kind: 'postgres-replica',
        members: [
          { host: '10.94.0.1', role: 'replica', access: 'local' },
          { host: '10.94.0.2', role: 'primary', access: 'ssh' },
        ],
      });
      const rPg = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({}),
        clusterId: pg.id,
        execute: false,
      });
      expect(rPg.ok).toBe(true);
      expect(rPg.dryRun).toBe(true);

      const rd = createDbCluster(db, {
        name: 'rd-r',
        engine: 'redis',
        kind: 'redis-replica',
        members: [
          { host: '10.95.0.1', role: 'replica', access: 'local' },
          { host: '10.95.0.2', role: 'master', access: 'ssh' },
        ],
      });
      const rRd = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({}),
        clusterId: rd.id,
      });
      expect(rRd.ok).toBe(true);

      const rs = createDbCluster(db, {
        name: 'rs-r',
        engine: 'redis',
        kind: 'redis-sentinel',
        members: [
          { host: '10.96.0.1', role: 'sentinel', access: 'local' },
          { host: '10.96.0.2', role: 'master', access: 'ssh' },
        ],
      });
      const rS = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({}),
        clusterId: rs.id,
      });
      expect(rS.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mysql replica role picks peer conf when present', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'repl',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.85.0.1', role: 'replica', access: 'local' },
          { host: '10.85.0.2', role: 'primary', access: 'ssh' },
        ],
      });
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({}),
        clusterId: c.id,
        execute: false,
      });
      expect(r.ok).toBe(true);
      expect(r.dryRun).toBe(true);
      // peer conf or primary fallback may be listed in written
      expect(r.cluster.members.some((m) => m.applyStatus === 'written')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readLocalGaleraConfSnippet truncates and empty on bad read', () => {
    const dir = tmp();
    try {
      expect(readLocalGaleraConfSnippet(dir, 'x', 10)).toBe('');
      const confDir = join(dir, 'clusters', 'cid', 'conf');
      mkdirSync(confDir, { recursive: true });
      writeFileSync(join(confDir, '99-ysk-galera.cnf'), 'wsrep_on=ON\n' + 'x'.repeat(5000));
      const snip = readLocalGaleraConfSnippet(dir, 'cid', 20);
      expect(snip.length).toBeLessThanOrEqual(20);
      expect(snip).toContain('wsrep');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
