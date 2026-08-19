import { describe, expect, it } from 'vitest';
import {
  clusterEngineFromServiceRow,
  clusterServicePath,
  clusterStatusLabel,
  clusterStatusTone,
  isStaleClusterPlan,
  pickClusterLandingPath,
  serviceRowLooksInstalled,
} from './cluster-landing';

describe('pickClusterLandingPath', () => {
  it('prefers an installed engine that already has a cluster', () => {
    expect(
      pickClusterLandingPath({
        clusters: [{ engine: 'redis' }, { engine: 'mysql' }],
        installed: { redis: true, mysql: false },
      }),
    ).toBe(clusterServicePath('redis'));
  });

  it('does not land on MySQL when MySQL is not installed', () => {
    expect(
      pickClusterLandingPath({
        clusters: [{ engine: 'mysql' }],
        installed: { mysql: false, mariadb: true },
      }),
    ).toBe(clusterServicePath('mariadb'));
  });

  it('returns null when no engine is installed', () => {
    expect(
      pickClusterLandingPath({
        clusters: [{ engine: 'mysql' }],
        installed: { mysql: false, mariadb: false, postgres: false, redis: false },
      }),
    ).toBeNull();
  });
});

describe('service row install probe', () => {
  it('treats a running Redis unit as installed', () => {
    expect(clusterEngineFromServiceRow({ id: 'redis', unit: 'redis-server.service' })).toBe(
      'redis',
    );
    expect(serviceRowLooksInstalled({ installed: false, active: 'active' })).toBe(true);
  });
});

describe('cluster status copy', () => {
  const t = (k: string, o?: Record<string, unknown>) =>
    o ? `${k}:${JSON.stringify(o)}` : k;

  it('maps planned / partial / failed like the engine cluster tab', () => {
    expect(clusterStatusLabel('planned', t)).toContain('db.cluster.status.planned');
    expect(clusterStatusLabel('partial', t)).toContain('db.cluster.status.partial');
    expect(clusterStatusLabel('failed', t)).toContain('db.cluster.status.failed');
    expect(clusterStatusTone('planned')).toBe('warn');
    expect(clusterStatusTone('partial')).toBe('warn');
    expect(clusterStatusTone('failed')).toBe('danger');
    expect(clusterStatusTone('healthy')).toBe('ok');
  });
});

describe('isStaleClusterPlan', () => {
  it('flags planned/draft older than 7 days', () => {
    const now = Date.parse('2026-08-17T00:00:00.000Z');
    expect(
      isStaleClusterPlan(
        { status: 'planned', createdAt: '2026-08-01T00:00:00.000Z' },
        now,
      ),
    ).toBe(true);
    expect(
      isStaleClusterPlan(
        { status: 'planned', createdAt: '2026-08-16T00:00:00.000Z' },
        now,
      ),
    ).toBe(false);
    expect(
      isStaleClusterPlan(
        { status: 'healthy', createdAt: '2026-08-01T00:00:00.000Z' },
        now,
      ),
    ).toBe(false);
  });
});
