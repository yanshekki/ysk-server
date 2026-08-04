/**
 * Low-level repair primitives shared by sql-engine-health execute.
 * Re-exports implementation from mysql-frozen to avoid duplication during migration.
 */

import type { HostExecutor } from '../../host/executor.js';
import {
  clearMysqlFrozen as clearFrozenImpl,
  sanitizeSqlConfigForFlavor as sanitizeImpl,
  initializeMysqlDatadirIfEmpty as initImpl,
} from '../sql-engine-switch/mysql-frozen.js';
import { unitIsActive } from '../software-probe/index.js';

export async function clearMysqlFrozen(host: HostExecutor) {
  return clearFrozenImpl(host);
}

export async function sanitizeSqlConfigForFlavor(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
) {
  return sanitizeImpl(host, flavor);
}

export async function initializeMysqlDatadirIfEmpty(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
) {
  return initImpl(host, flavor);
}

export async function waitUnitActiveHelper(
  host: HostExecutor,
  unit: string,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const a = await unitIsActive(host, unit);
    if (a === 'active') return true;
    if (a === 'failed') return false;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const last = await unitIsActive(host, unit);
  return last === 'active';
}
