import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import {
  createDbCluster,
  listDbClusters,
  getDbCluster,
  updateDbCluster,
  deleteDbCluster,
  setDbClusterStatus,
} from './store.js';
import { YskError } from '@ysk/shared';

function tempDb(): { db: JsonStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ysk-dbc-'));
  const db = new JsonStore(join(dir, 'store.json'));
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('db-cluster store', () => {
  it('creates galera cluster with defaults and lists by engine', () => {
    const { db, cleanup } = tempDb();
    const c = createDbCluster(db, {
      name: 'galera-1',
      engine: 'mariadb',
      kind: 'mariadb-galera',
      members: [
        { host: '127.0.0.1', access: 'local' },
        { host: '10.0.0.2', access: 'ssh' },
      ],
    });
    expect(c.status).toBe('draft');
    expect(c.params.clusterName).toBeTruthy();
    expect(c.params.sstMethod).toBe('mariabackup');
    expect(listDbClusters(db)).toHaveLength(1);
    expect(listDbClusters(db, 'mariadb')).toHaveLength(1);
    expect(listDbClusters(db, 'redis')).toHaveLength(0);
    expect(getDbCluster(db, c.id).id).toBe(c.id);
    cleanup();
  });

  it('rejects invalid engine/kind combinations and bad hosts', () => {
    const { db, cleanup } = tempDb();
    expect(() =>
      createDbCluster(db, {
        name: 'bad',
        engine: 'mysql',
        kind: 'mariadb-galera',
        members: [{ host: '127.0.0.1' }],
      }),
    ).toThrow(YskError);
    expect(() =>
      createDbCluster(db, {
        name: 'bad2',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [{ host: 'example.com' }],
      }),
    ).toThrow(YskError);
    expect(() =>
      createDbCluster(db, {
        name: '',
        engine: 'redis',
        kind: 'redis-replica',
        members: [{ host: '127.0.0.1' }],
      }),
    ).toThrow(YskError);
    cleanup();
  });

  it('updates status and deletes', () => {
    const { db, cleanup } = tempDb();
    const c = createDbCluster(db, {
      name: 'redis-c',
      engine: 'redis',
      kind: 'redis-replica',
      members: [
        { host: '127.0.0.1' },
        { host: '10.0.0.3' },
      ],
    });
    const planned = setDbClusterStatus(db, c.id, 'planned', ['note-a']);
    expect(planned.status).toBe('planned');
    expect(planned.notes).toContain('note-a');
    const renamed = updateDbCluster(db, c.id, { name: 'redis-renamed' });
    expect(renamed.name).toBe('redis-renamed');
    expect(deleteDbCluster(db, c.id)).toBe(true);
    expect(deleteDbCluster(db, c.id)).toBe(false);
    expect(() => getDbCluster(db, c.id)).toThrow(YskError);
    cleanup();
  });

  it('postgres replica gets repl user defaults', () => {
    const { db, cleanup } = tempDb();
    const c = createDbCluster(db, {
      name: 'pg1',
      engine: 'postgres',
      kind: 'postgres-replica',
      members: [{ host: '127.0.0.1' }, { host: '10.0.0.4' }],
    });
    expect(c.params.replUser).toBe('ysk_repl');
    expect(c.members[0]!.role).toMatch(/primary|master/);
    cleanup();
  });
});
