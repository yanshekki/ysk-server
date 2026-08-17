import { describe, expect, it } from 'vitest';
import {
  clusterServicePath,
  isStaleClusterPlan,
  pickClusterLandingPath,
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
