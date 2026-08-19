import { describe, expect, it } from 'vitest';
import { sqlEngineMatchesRow } from './resources-read.js';

describe('sqlEngineMatchesRow', () => {
  it('matches only the requested engine (legacy empty engine still matches)', () => {
    expect(sqlEngineMatchesRow('mysql', 'mysql')).toBe(true);
    expect(sqlEngineMatchesRow('mariadb', 'mariadb')).toBe(true);
    expect(sqlEngineMatchesRow('mysql', 'mariadb')).toBe(false);
    expect(sqlEngineMatchesRow('mariadb', 'mysql')).toBe(false);
    expect(sqlEngineMatchesRow(undefined, 'mariadb')).toBe(true);
    expect(sqlEngineMatchesRow('', 'mysql')).toBe(true);
    expect(sqlEngineMatchesRow('postgres', 'mariadb')).toBe(false);
  });
});
