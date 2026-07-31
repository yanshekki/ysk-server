import { describe, expect, it } from 'vitest';
import type { DbCluster, DbClusterMember } from './types.js';
import {
  planRedisReplica,
  renderRedisMasterConf,
  renderRedisPlanMd,
  renderRedisReplicaConf,
  renderRedisSentinelConf,
} from './plan-redis-replica.js';

function member(
  partial: Partial<DbClusterMember> & { host: string; id?: string },
): DbClusterMember {
  return {
    id: partial.id ?? partial.host,
    role: partial.role ?? 'replica',
    host: partial.host,
    port: partial.port ?? 6379,
    label: partial.label,
    access: partial.access ?? 'ssh',
    applyStatus: 'none',
  };
}

function redisCluster(overrides: Partial<DbCluster> = {}): DbCluster {
  return {
    id: 'cl-redis-1',
    name: 'redis-ha',
    engine: 'redis',
    kind: 'redis-replica',
    status: 'draft',
    members: [
      member({ id: 'm1', host: '10.50.0.1', role: 'master', access: 'local' }),
      member({ id: 'r1', host: '10.50.0.2', role: 'replica' }),
    ],
    params: {},
    notes: [],
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function sentinelCluster(overrides: Partial<DbCluster> = {}): DbCluster {
  return redisCluster({
    kind: 'redis-sentinel',
    members: [
      member({ id: 'm1', host: '10.51.0.1', role: 'master', access: 'local' }),
      member({ id: 'r1', host: '10.51.0.2', role: 'replica' }),
      member({ id: 's1', host: '10.51.0.3', role: 'sentinel', port: 26379 }),
      member({ id: 's2', host: '10.51.0.4', role: 'sentinel', port: 26379 }),
      member({ id: 's3', host: '10.51.0.5', role: 'sentinel', port: 26379 }),
    ],
    ...overrides,
  });
}

describe('plan-redis-replica pure', () => {
  it('renders master conf with default and custom port', () => {
    expect(renderRedisMasterConf(redisCluster())).toContain('port 6379');
    expect(renderRedisMasterConf(redisCluster())).toContain('appendonly yes');
    expect(renderRedisMasterConf(redisCluster({ params: { port: 6380 } }))).toContain(
      'port 6380',
    );
    expect(renderRedisMasterConf(redisCluster())).toContain('CHANGE_ME');
  });

  it('renders replicaof pointing at master', () => {
    const c = redisCluster();
    const conf = renderRedisReplicaConf(c, c.members[1]!);
    expect(conf).toContain('replicaof 10.50.0.1 6379');
    expect(conf).toContain('this=10.50.0.2');
  });

  it('renders sentinel conf with quorum and monitor name', () => {
    const c = sentinelCluster({ params: { sentinelName: 'my@redis!', quorum: 2 } });
    const conf = renderRedisSentinelConf(c, c.members[2]!);
    expect(conf).toContain('port 26379');
    expect(conf).toContain('sentinel monitor my-redis- 10.51.0.1 6379 2');
    expect(conf).toContain('sentinel down-after-milliseconds my-redis- 5000');
  });

  it('defaults quorum from sentinel count when not set', () => {
    const c = sentinelCluster({ params: {} });
    // 3 sentinels → floor(3/2)+1 = 2
    const conf = renderRedisSentinelConf(c, c.members[2]!);
    expect(conf).toMatch(/sentinel monitor redis-ha 10\.51\.0\.1 6379 2/);
  });

  it('plan.md includes replicas and sentinel section when applicable', () => {
    const replicaMd = renderRedisPlanMd(redisCluster());
    expect(replicaMd).toContain('Redis redis-replica plan');
    expect(replicaMd).toContain('10.50.0.1');
    expect(replicaMd).not.toContain('sentinels:');

    const sentMd = renderRedisPlanMd(sentinelCluster());
    expect(sentMd).toContain('redis-sentinel');
    expect(sentMd).toContain('sentinels:');
    expect(sentMd).toContain('10.51.0.3');
  });

  it('plans redis-replica with master + replica conf files', () => {
    const plan = planRedisReplica(redisCluster());
    expect(plan.ok).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(plan.files.map((f) => f.relativePath)).toEqual(
      expect.arrayContaining([
        'conf/99-ysk-redis-master.conf',
        'plan.md',
        'conf/peers/10.50.0.2-replica.conf',
      ]),
    );
    expect(plan.steps.some((s) => s.id === 'conf-master')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'conf-replica-r1')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'probe')).toBe(true);
    expect(plan.files.some((f) => f.relativePath.includes('sentinel'))).toBe(false);
  });

  it('plans redis-sentinel with sentinel conf steps', () => {
    const plan = planRedisReplica(sentinelCluster());
    expect(plan.ok).toBe(true);
    expect(plan.files.some((f) => f.relativePath.endsWith('-sentinel.conf'))).toBe(true);
    expect(plan.steps.filter((s) => s.id.startsWith('conf-sentinel-')).length).toBe(3);
    // sentinels must not appear as replicas
    expect(plan.files.some((f) => f.relativePath.includes('10.51.0.3-replica'))).toBe(false);
  });

  it('notes missing sentinels for sentinel kind and missing replicas', () => {
    const noSent = planRedisReplica(
      sentinelCluster({
        members: [
          member({ id: 'm1', host: '10.51.0.1', role: 'master', access: 'local' }),
          member({ id: 'r1', host: '10.51.0.2', role: 'replica' }),
        ],
      }),
    );
    expect(noSent.ok).toBe(true);
    expect(noSent.notes.length).toBeGreaterThan(0);

    const solo = planRedisReplica(
      redisCluster({
        members: [member({ id: 'm1', host: '10.50.0.1', role: 'master', access: 'local' })],
      }),
    );
    expect(solo.ok).toBe(true);
    expect(solo.notes.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects wrong engine/kind and empty members', () => {
    expect(planRedisReplica(redisCluster({ engine: 'mysql' })).ok).toBe(false);
    expect(planRedisReplica(redisCluster({ kind: 'mysql-replica' })).ok).toBe(false);
    expect(planRedisReplica(redisCluster({ members: [] })).ok).toBe(false);
  });

  it('treats primary role as master alias', () => {
    const c = redisCluster({
      members: [
        member({ id: 'm1', host: '10.50.0.9', role: 'primary', access: 'local' }),
        member({ id: 'r1', host: '10.50.0.10', role: 'replica' }),
      ],
    });
    const conf = renderRedisReplicaConf(c, c.members[1]!);
    expect(conf).toContain('replicaof 10.50.0.9 6379');
    expect(planRedisReplica(c).ok).toBe(true);
  });
});
