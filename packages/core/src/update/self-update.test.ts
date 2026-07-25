import { describe, expect, it } from 'vitest';
import { compareVersions, isValidSha256, planSelfUpdate } from './self-update.js';

describe('self-update', () => {
  it('compares versions and plans migrate/verify/rollback', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);

    const plan = planSelfUpdate({
      current: '0.1.0',
      latest: '0.2.0',
      checksumSha256: 'a'.repeat(64),
    });
    expect(plan.status.updateAvailable).toBe(true);
    expect(plan.steps).toContain('run-migrations');
    expect(plan.steps).toContain('health-verify');
    expect(plan.rollback.length).toBeGreaterThan(0);
    expect(plan.migrate.some((m) => m.includes('migrate'))).toBe(true);
    expect(isValidSha256('a'.repeat(64))).toBe(true);
    expect(isValidSha256('nope')).toBe(false);
  });
});
