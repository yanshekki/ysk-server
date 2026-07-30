import { describe, expect, it } from 'vitest';
import { isMigratePhase, MIGRATE_PHASES } from './migrate.js';

describe('migrate contract', () => {
  it('lists all phases', () => {
    expect(MIGRATE_PHASES).toContain('inventory');
    expect(MIGRATE_PHASES).toContain('done');
    expect(MIGRATE_PHASES).toContain('failed');
  });

  it('isMigratePhase', () => {
    expect(isMigratePhase('inventory')).toBe(true);
    expect(isMigratePhase('nope')).toBe(false);
    expect(isMigratePhase(1)).toBe(false);
  });
});
