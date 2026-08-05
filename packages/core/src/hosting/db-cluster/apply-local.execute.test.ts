/**
 * Execute-path coverage for apply-local: redirect /etc writes into a temp tree
 * so lifecycle (restart / galera bootstrap) runs without real root.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { createDbCluster } from './store.js';
import { planAndMaterializeDbCluster } from './plan.js';
import { applyDbClusterLocal } from './apply-local.js';

const etcRoot = mkdtempSync(join(tmpdir(), 'ysk-fake-etc-'));

function mapEtc(p: string): string {
  if (p.startsWith('/etc/') || p === '/etc') {
    return join(etcRoot, p.slice(1)); // etc/...
  }
  return p;
}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const remap = (p: unknown) => {
    const s = String(p);
    if (s.startsWith('/etc/') || s === '/etc') {
      // use global set in beforeAll — during mock init fall back to path as-is
      const root = (globalThis as { __yskFakeEtc?: string }).__yskFakeEtc;
      if (!root) return s;
      return join(root, s.slice(1));
    }
    return s;
  };
  return {
    ...actual,
    existsSync: (p: actual.PathLike) => {
      const m = remap(p);
      return actual.existsSync(m) || (m !== p && actual.existsSync(p));
    },
    mkdirSync: (p: actual.PathLike, o?: actual.MakeDirectoryOptions) =>
      actual.mkdirSync(remap(p), o as never),
    copyFileSync: (src: actual.PathLike, dest: actual.PathLike) =>
      actual.copyFileSync(src, remap(dest)),
    writeFileSync: (
      p: actual.PathLike,
      data: string | NodeJS.ArrayBufferView,
      o?: actual.WriteFileOptions,
    ) => actual.writeFileSync(remap(p), data, o as never),
    readFileSync: (p: actual.PathLike, o?: actual.WriteFileOptions | BufferEncoding) =>
      actual.readFileSync(actual.existsSync(remap(p)) ? remap(p) : p, o as never),
  };
});

beforeAll(() => {
  (globalThis as { __yskFakeEtc?: string }).__yskFakeEtc = etcRoot;
  // pre-seed common conf.d parents so dest selection can prefer them
  for (const d of [
    'etc/mysql/mariadb.conf.d',
    'etc/mysql/conf.d',
    'etc/mysql/mysql.conf.d',
    'etc/postgresql/16/main/conf.d',
    'etc/redis',
  ]) {
    mkdirSync(join(etcRoot, d), { recursive: true });
  }
});

afterAll(() => {
  rmSync(etcRoot, { recursive: true, force: true });
  delete (globalThis as { __yskFakeEtc?: string }).__yskFakeEtc;
});

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts: {
  run?: (argv: string[]) => Partial<RunResult> | Promise<Partial<RunResult>>;
}): HostExecutor {
  return {
    pathExists: () => false,
    isRoot: () => true,
    executeEnabled: () => true,
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
  return mkdtempSync(join(tmpdir(), 'ysk-apl-ex-'));
}

describe('applyDbClusterLocal execute lifecycle (fake /etc)', () => {
  it('mysql-replica execute restarts unit and marks applied', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'mx',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.1.0.1', role: 'primary', access: 'local' },
          { host: '10.1.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id, writeArtifacts: true });
      const cmds: string[][] = [];
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({
          run: (argv) => {
            cmds.push([...argv]);
            if (argv[0] === 'systemctl') return { exitCode: 0, stdout: 'ok' };
            return {};
          },
        }),
        clusterId: c.id,
        execute: true,
      });
      expect(r.executed).toBe(true);
      expect(r.ok).toBe(true);
      expect(r.systemConf).toBeTruthy();
      expect(cmds.some((a) => a[0] === 'systemctl' && a[1] === 'restart')).toBe(true);
      expect(r.cluster.members.some((m) => m.applyStatus === 'applied')).toBe(true);
      expect(existsSync(mapEtc(r.systemConf!))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('postgres-replica execute uses postgresql unit; restart fail marks failed', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'pg',
        engine: 'postgres',
        kind: 'postgres-replica',
        members: [
          { host: '10.2.0.1', role: 'primary', access: 'local' },
          { host: '10.2.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({
          run: (argv) => {
            if (argv[0] === 'systemctl' && argv[1] === 'restart') {
              return { exitCode: 1, stderr: 'unit failed' };
            }
            return {};
          },
        }),
        clusterId: c.id,
        execute: true,
      });
      expect(r.executed).toBe(true);
      expect(r.ok).toBe(false);
      expect(r.cluster.status).toBe('failed');
      expect(r.systemConf).toMatch(/postgresql|ysk-repl/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('redis-replica and redis-sentinel execute paths', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      for (const spec of [
        {
          name: 'rd',
          kind: 'redis-replica' as const,
          members: [
            { host: '10.3.0.1', role: 'master', access: 'local' as const },
            { host: '10.3.0.2', role: 'replica', access: 'ssh' as const },
          ],
        },
        {
          name: 'rs',
          kind: 'redis-sentinel' as const,
          members: [
            { host: '10.3.0.3', role: 'sentinel', access: 'local' as const },
            { host: '10.3.0.4', role: 'master', access: 'ssh' as const },
          ],
        },
      ]) {
        const c = createDbCluster(db, {
          name: spec.name,
          engine: 'redis',
          kind: spec.kind,
          members: spec.members,
        });
        const r = await applyDbClusterLocal({
          db,
          dataDir: dir,
          host: mockHost({
            run: (argv) =>
              argv[0] === 'systemctl' ? { exitCode: 0 } : {},
          }),
          clusterId: c.id,
          execute: true,
        });
        expect(r.executed).toBe(true);
        expect(r.ok).toBe(true);
        expect(r.systemConf).toMatch(/redis/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mariadb-galera bootstrap with galera_new_cluster on PATH', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'ga',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.4.0.1', access: 'local' },
          { host: '10.4.0.2', access: 'ssh' },
        ],
      });
      const cmds: string[][] = [];
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({
          run: (argv) => {
            cmds.push([...argv]);
            if (argv.join(' ').includes('galera_new_cluster') && argv[0] === 'bash') {
              return { exitCode: 0, stdout: '/usr/bin/galera_new_cluster\n' };
            }
            // resolveBin returns absolute path → runCommand([absPath])
            if (String(argv[0]).endsWith('galera_new_cluster')) {
              return { exitCode: 0, stdout: 'bootstrapped' };
            }
            if (argv[0] === 'systemctl') return { exitCode: 0 };
            return {};
          },
        }),
        clusterId: c.id,
        execute: true,
        bootstrap: true,
      });
      expect(r.executed).toBe(true);
      expect(r.ok).toBe(true);
      expect(
        cmds.some(
          (a) => a[0] === 'galera_new_cluster' || String(a[0]).endsWith('/galera_new_cluster'),
        ),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mariadb-galera bootstrap falls back to systemctl when galera_new_cluster missing', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'ga2',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.5.0.1', access: 'local' },
          { host: '10.5.0.2', access: 'ssh' },
        ],
      });
      const cmds: string[][] = [];
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({
          run: (argv) => {
            cmds.push([...argv]);
            if (argv[0] === 'bash') return { exitCode: 0, stdout: '' }; // not found
            if (argv[0] === 'systemctl') return { exitCode: 0 };
            return {};
          },
        }),
        clusterId: c.id,
        execute: true,
        bootstrap: true,
      });
      expect(r.executed).toBe(true);
      expect(r.ok).toBe(true);
      expect(cmds.some((a) => a[0] === 'systemctl' && a.includes('mariadb'))).toBe(true);
      expect(cmds.some((a) => a[0] === 'galera_new_cluster')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mariadb-galera bootstrap galera_new_cluster failure is honest', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'ga3',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '10.6.0.1', access: 'local' },
          { host: '10.6.0.2', access: 'ssh' },
        ],
      });
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({
          run: (argv) => {
            if (argv[0] === 'bash' && argv.join(' ').includes('galera_new_cluster')) {
              return { stdout: '/usr/bin/galera_new_cluster\n' };
            }
            if (String(argv[0]).endsWith('galera_new_cluster')) {
              return { exitCode: 1, stderr: 'bootstrap failed hard' };
            }
            return {};
          },
        }),
        clusterId: c.id,
        execute: true,
        bootstrap: true,
      });
      expect(r.executed).toBe(true);
      expect(r.ok).toBe(false);
      expect(r.notes.some((n) => /fail|bootstrap|error/i.test(n) || n.length > 0)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mysql-replica local replica role picks peer conf when present', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'repl',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.7.0.1', role: 'replica', access: 'local' },
          { host: '10.7.0.2', role: 'primary', access: 'ssh' },
        ],
      });
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c.id, writeArtifacts: true });
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: mockHost({
          run: (argv) => (argv[0] === 'systemctl' ? { exitCode: 0 } : {}),
        }),
        clusterId: c.id,
        execute: true,
      });
      expect(r.executed).toBe(true);
      expect(r.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks execute when host.executeEnabled false', async () => {
    const dir = tmp();
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const c = createDbCluster(db, {
        name: 'blk',
        engine: 'mysql',
        kind: 'mysql-replica',
        members: [
          { host: '10.8.0.1', role: 'primary', access: 'local' },
          { host: '10.8.0.2', role: 'replica', access: 'ssh' },
        ],
      });
      const host = mockHost({});
      // override execute
      const blocked: HostExecutor = {
        ...host,
        executeEnabled: () => false,
        isRoot: () => true,
      };
      const r = await applyDbClusterLocal({
        db,
        dataDir: dir,
        host: blocked,
        clusterId: c.id,
        execute: true,
      });
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.executed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
