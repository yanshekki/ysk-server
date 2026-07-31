import { describe, expect, it } from 'vitest';
import type { DbCluster, DbClusterMember } from './types.js';
import {
  planMysqlReplica,
  renderMysqlChangeReplicationSql,
  renderMysqlPrimaryCnf,
  renderMysqlPrimaryGrantsSql,
  renderMysqlReplicaCnf,
  renderMysqlReplicaPlanMd,
} from './plan-mysql-replica.js';

function member(
  partial: Partial<DbClusterMember> & { host: string; id?: string },
): DbClusterMember {
  return {
    id: partial.id ?? partial.host,
    role: partial.role ?? 'replica',
    host: partial.host,
    port: partial.port ?? 3306,
    label: partial.label,
    access: partial.access ?? 'ssh',
    applyStatus: 'none',
  };
}

function mysqlCluster(overrides: Partial<DbCluster> = {}): DbCluster {
  return {
    id: 'cl-mysql-1',
    name: 'mysql-repl',
    engine: 'mysql',
    kind: 'mysql-replica',
    status: 'draft',
    members: [
      member({ id: 'p1', host: '10.20.0.1', role: 'primary', access: 'local' }),
      member({ id: 'r1', host: '10.20.0.2', role: 'replica', access: 'ssh' }),
    ],
    params: {},
    notes: [],
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('plan-mysql-replica pure', () => {
  it('renders primary cnf with server-id base and gtid', () => {
    const c = mysqlCluster({ params: { serverIdBase: 200 } });
    const cnf = renderMysqlPrimaryCnf(c, c.members[0]!, 0);
    expect(cnf).toContain('server-id=200');
    expect(cnf).toContain('gtid_mode=ON');
    expect(cnf).toContain('log_bin=mysql-bin');
    expect(cnf).toContain(c.id);
  });

  it('renders replica cnf read-only with report_host and sequential server-id', () => {
    const c = mysqlCluster({ params: { serverIdBase: 50 } });
    const cnf = renderMysqlReplicaCnf(c, c.members[1]!, 1);
    expect(cnf).toContain('server-id=51');
    expect(cnf).toContain('report_host=10.20.0.2');
    expect(cnf).toContain('read_only=ON');
    expect(cnf).toContain('super_read_only=ON');
    expect(cnf).toContain('primary=10.20.0.1');
  });

  it('sanitizes repl user in grants and change-source SQL', () => {
    const c = mysqlCluster({ params: { replUser: 'ysk-repl@bad!' } });
    const grants = renderMysqlPrimaryGrantsSql(c);
    expect(grants).toContain("CREATE USER IF NOT EXISTS 'ysk_repl_bad_'@'%'");
    expect(grants).toContain('CHANGE_ME');
    expect(grants).toContain('REPLICATION SLAVE');

    const ch = renderMysqlChangeReplicationSql(c);
    expect(ch).toContain("SOURCE_HOST='10.20.0.1'");
    expect(ch).toContain('SOURCE_PORT=3306');
    expect(ch).toContain("SOURCE_USER='ysk_repl_bad_'");
    expect(ch).toContain('SOURCE_PASSWORD=\'CHANGE_ME\'');
    expect(ch).toContain('START REPLICA');
  });

  it('uses primary port when set and master role alias', () => {
    const c = mysqlCluster({
      members: [
        member({
          id: 'p1',
          host: '10.30.0.1',
          role: 'master',
          access: 'local',
          port: 3307,
        }),
        member({ id: 'r1', host: '10.30.0.2', role: 'replica' }),
      ],
    });
    const ch = renderMysqlChangeReplicationSql(c);
    expect(ch).toContain("SOURCE_HOST='10.30.0.1'");
    expect(ch).toContain('SOURCE_PORT=3307');
  });

  it('plan.md lists primary, replicas, and honesty about passwords', () => {
    const md = renderMysqlReplicaPlanMd(mysqlCluster());
    expect(md).toContain('MySQL primary→replica plan');
    expect(md).toContain('10.20.0.1');
    expect(md).toContain('10.20.0.2');
    expect(md).toMatch(/ysk_repl/);
    expect(md).toMatch(/Password never written|CHANGE_ME|Honesty/i);
  });

  it('plans files and steps for primary + each replica', () => {
    const plan = planMysqlReplica(mysqlCluster());
    expect(plan.ok).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(plan.files.map((f) => f.relativePath)).toEqual(
      expect.arrayContaining([
        'conf/99-ysk-mysql-primary.cnf',
        'plan.md',
        'scripts/primary-grants.sql',
        'scripts/replica-change-source.sql',
        'conf/peers/10.20.0.2-replica.cnf',
      ]),
    );
    expect(plan.steps.some((s) => s.id === 'conf-primary')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'sql-grants')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'conf-replica-r1')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'sql-replica-r1')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'probe' && s.risk === 'read')).toBe(true);
    expect(plan.notes.some((n) => n.includes('primary=10.20.0.1'))).toBe(true);
  });

  it('notes missing replica but still ok with primary only', () => {
    const plan = planMysqlReplica(
      mysqlCluster({
        members: [member({ id: 'p1', host: '10.20.0.1', role: 'primary', access: 'local' })],
      }),
    );
    expect(plan.ok).toBe(true);
    expect(plan.notes.length).toBeGreaterThan(0);
    expect(plan.files.some((f) => f.relativePath.includes('primary'))).toBe(true);
  });

  it('rejects wrong engine/kind', () => {
    expect(planMysqlReplica(mysqlCluster({ engine: 'mariadb' })).ok).toBe(false);
    expect(planMysqlReplica(mysqlCluster({ kind: 'mariadb-galera' })).ok).toBe(false);
    expect(planMysqlReplica(mysqlCluster({ engine: 'mariadb' })).files).toHaveLength(0);
  });

  it('rejects empty members', () => {
    const plan = planMysqlReplica(mysqlCluster({ members: [] }));
    expect(plan.ok).toBe(false);
    expect(plan.steps).toHaveLength(0);
  });
});
