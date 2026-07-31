import { describe, expect, it } from 'vitest';
import type { DbCluster, DbClusterMember } from './types.js';
import {
  planPostgresReplica,
  renderPostgresBasebackupSh,
  renderPostgresPlanMd,
  renderPostgresPrimaryConf,
  renderPostgresPrimarySql,
  renderPostgresReplicaConf,
} from './plan-postgres-replica.js';

function member(
  partial: Partial<DbClusterMember> & { host: string; id?: string },
): DbClusterMember {
  return {
    id: partial.id ?? partial.host,
    role: partial.role ?? 'replica',
    host: partial.host,
    port: partial.port ?? 5432,
    label: partial.label,
    access: partial.access ?? 'ssh',
    applyStatus: 'none',
  };
}

function pgCluster(overrides: Partial<DbCluster> = {}): DbCluster {
  return {
    id: 'cl-pg-1',
    name: 'pg-stream',
    engine: 'postgres',
    kind: 'postgres-replica',
    status: 'draft',
    members: [
      member({ id: 'p1', host: '10.40.0.1', role: 'primary', access: 'local' }),
      member({ id: 'r1', host: '10.40.0.2', role: 'replica', label: 'standby-1' }),
    ],
    params: {},
    notes: [],
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('plan-postgres-replica pure', () => {
  it('renders primary conf with streaming wal settings', () => {
    const conf = renderPostgresPrimaryConf(pgCluster());
    expect(conf).toContain('wal_level = replica');
    expect(conf).toContain('max_wal_senders = 10');
    expect(conf).toContain('hot_standby = on');
    expect(conf).toContain('listen_addresses = \'*\'');
    expect(conf).toContain('cl-pg-1');
  });

  it('renders replica conf with primary_conninfo and CHANGE_ME password', () => {
    const c = pgCluster({ params: { replUser: 'repl-user!' } });
    const conf = renderPostgresReplicaConf(c, c.members[1]!);
    expect(conf).toContain('primary_conninfo');
    expect(conf).toContain('host=10.40.0.1');
    expect(conf).toContain('port=5432');
    expect(conf).toContain('user=repl_user_');
    expect(conf).toContain('password=CHANGE_ME');
    expect(conf).toContain('application_name=standby-1');
  });

  it('uses custom primary port in basebackup and conninfo', () => {
    const c = pgCluster({
      members: [
        member({ id: 'p1', host: '10.40.0.1', role: 'primary', port: 5433, access: 'local' }),
        member({ id: 'r1', host: '10.40.0.2', role: 'replica' }),
      ],
    });
    expect(renderPostgresReplicaConf(c, c.members[1]!)).toContain('port=5433');
    const sh = renderPostgresBasebackupSh(c);
    expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(sh).toContain('PRIMARY="10.40.0.1"');
    expect(sh).toContain('pg_basebackup');
    expect(sh).toContain('pg_is_in_recovery');
  });

  it('renders primary role SQL with sanitized user', () => {
    const sql = renderPostgresPrimarySql(pgCluster({ params: { replUser: 'ysk.repl' } }));
    expect(sql).toContain('CREATE ROLE ysk_repl WITH REPLICATION LOGIN');
    expect(sql).toContain("PASSWORD 'CHANGE_ME'");
    expect(sql).toContain('pg_reload_conf');
  });

  it('plan.md documents order and honesty', () => {
    const md = renderPostgresPlanMd(pgCluster());
    expect(md).toContain('PostgreSQL streaming plan');
    expect(md).toContain('10.40.0.1');
    expect(md).toContain('pg_basebackup');
    expect(md).toMatch(/Honesty|Plan ≠/i);
  });

  it('plans conf, sql, basebackup steps and peer files', () => {
    const plan = planPostgresReplica(pgCluster());
    expect(plan.ok).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(plan.files.map((f) => f.relativePath)).toEqual(
      expect.arrayContaining([
        'conf/99-ysk-postgres-primary.conf',
        'plan.md',
        'scripts/primary-repl-role.sql',
        'scripts/replica-basebackup.sh',
        'conf/peers/10.40.0.2-replica.conf',
      ]),
    );
    expect(plan.steps.some((s) => s.id === 'conf-primary')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'sql-role')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'conf-replica-r1')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'basebackup-r1')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'probe')).toBe(true);
    expect(plan.notes.some((n) => n.includes('primary=10.40.0.1'))).toBe(true);
  });

  it('notes when no replicas', () => {
    const plan = planPostgresReplica(
      pgCluster({
        members: [member({ id: 'p1', host: '10.40.0.1', role: 'primary', access: 'local' })],
      }),
    );
    expect(plan.ok).toBe(true);
    expect(plan.notes.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects wrong engine/kind and empty members', () => {
    expect(planPostgresReplica(pgCluster({ engine: 'mysql' })).ok).toBe(false);
    expect(planPostgresReplica(pgCluster({ kind: 'mysql-replica' })).ok).toBe(false);
    expect(planPostgresReplica(pgCluster({ members: [] })).ok).toBe(false);
  });
});
