import { describe, expect, it } from 'vitest';
import { sqlEngineMatchesRow } from './resources-read.js';

describe('sqlEngineMatchesRow', () => {
  it('treats mysql and mariadb as one exclusive pool', () => {
    expect(sqlEngineMatchesRow('mysql', 'mariadb')).toBe(true);
    expect(sqlEngineMatchesRow('mariadb', 'mysql')).toBe(true);
    expect(sqlEngineMatchesRow(undefined, 'mariadb')).toBe(true);
    expect(sqlEngineMatchesRow('', 'mysql')).toBe(true);
    expect(sqlEngineMatchesRow('postgres', 'mariadb')).toBe(false);
  });
});
