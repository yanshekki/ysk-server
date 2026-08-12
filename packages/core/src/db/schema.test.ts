import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './schema.js';

describe('schema migrations', () => {
  it('versions are strictly increasing and unique', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    const versions = MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]!).toBeGreaterThan(versions[i - 1]!);
    }
  });

  it('each migration has non-empty SQL with schema or data change', () => {
    for (const m of MIGRATIONS) {
      expect(m.sql.trim().length).toBeGreaterThan(10);
      expect(/CREATE|ALTER|INSERT|UPDATE|DELETE|DROP/i.test(m.sql)).toBe(true);
    }
  });

  it('v1 defines core control-plane tables', () => {
    const v1 = MIGRATIONS.find((m) => m.version === 1);
    expect(v1).toBeTruthy();
    for (const table of ['users', 'sessions', 'projects', 'audit_events', 'settings']) {
      expect(v1!.sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
    }
  });
});
