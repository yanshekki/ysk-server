import type { ServiceEngine, SettingDef } from './types.js';
import { filterDefsByVersion } from './types.js';
import { MYSQL_SETTING_DEFS, MARIADB_SETTING_DEFS } from './mysql.js';
import { POSTGRES_SETTING_DEFS } from './postgres.js';
import { REDIS_SETTING_DEFS } from './redis.js';

export * from './types.js';
export { MYSQL_SETTING_DEFS, MARIADB_SETTING_DEFS } from './mysql.js';
export { POSTGRES_SETTING_DEFS } from './postgres.js';
export { REDIS_SETTING_DEFS } from './redis.js';

export function catalogForEngine(engine: ServiceEngine, version?: string): SettingDef[] {
  const raw =
    engine === 'mysql'
      ? MYSQL_SETTING_DEFS
      : engine === 'mariadb'
        ? MARIADB_SETTING_DEFS
        : engine === 'postgres'
          ? POSTGRES_SETTING_DEFS
          : REDIS_SETTING_DEFS;
  return filterDefsByVersion(raw, version);
}
