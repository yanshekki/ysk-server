import { describe, expect, it } from 'vitest';
import { MYSQL_SETTING_DEFS } from './mysql.js';
import { POSTGRES_SETTING_DEFS } from './postgres.js';
import { REDIS_SETTING_DEFS } from './redis.js';

describe('service-catalog', () => {
  it('exports setting defs for engines', () => {
    expect(MYSQL_SETTING_DEFS.length).toBeGreaterThan(5);
    expect(MYSQL_SETTING_DEFS.some((d) => d.key === 'max_connections')).toBe(true);
    expect(POSTGRES_SETTING_DEFS.length).toBeGreaterThan(3);
    expect(REDIS_SETTING_DEFS.length).toBeGreaterThan(3);
    expect(REDIS_SETTING_DEFS.some((d) => d.key === 'maxmemory' || d.label)).toBe(true);
  });
});
