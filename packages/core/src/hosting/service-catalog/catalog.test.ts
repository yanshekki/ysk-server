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

  it('charset and collation are enum selections', () => {
    const cs = MYSQL_SETTING_DEFS.find((d) => d.key === 'character_set_server');
    const col = MYSQL_SETTING_DEFS.find((d) => d.key === 'collation_server');
    expect(cs?.type).toBe('enum');
    expect(col?.type).toBe('enum');
    expect(cs?.enumValues?.includes('utf8mb4')).toBe(true);
    expect(col?.enumValues?.some((v) => v.startsWith('utf8mb4_'))).toBe(true);
  });

  it('bind addresses and auth plugins are selections not free text', () => {
    const bind = MYSQL_SETTING_DEFS.find((d) => d.key === 'bind_address');
    const auth = MYSQL_SETTING_DEFS.find((d) => d.key === 'default_authentication_plugin');
    expect(bind?.type).toBe('enum');
    expect(bind?.enumValues?.includes('127.0.0.1')).toBe(true);
    expect(auth?.type).toBe('enum');
    expect(auth?.enumValues?.includes('caching_sha2_password')).toBe(true);
  });
});
