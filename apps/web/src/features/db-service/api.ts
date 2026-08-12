/**
 * DB service settings API — redis | mysql | mariadb | postgres
 */
import { api } from '../../shared/services/api';

export type {
  DbServiceEngine,
  RedisServiceSettings,
  SqlServiceSettings,
  PostgresServiceSettings,
} from '@yanshekki/shared';

import type { DbServiceEngine } from '@yanshekki/shared';

function base(engine: DbServiceEngine) {
  return `/api/v1/system/db/${engine}`;
}

export const dbServiceApi = {
  status: (engine: DbServiceEngine) =>
    api.requestRaw<Record<string, unknown>>(`${base(engine)}/status`),
  getSettings: (engine: DbServiceEngine) =>
    api.requestRaw<{ settings: Record<string, unknown>; status: Record<string, unknown> }>(
      `${base(engine)}/settings`,
    ),
  saveSettings: (engine: DbServiceEngine, body: Record<string, unknown>) =>
    api.requestRaw<{ ok: boolean; settings: Record<string, unknown> }>(`${base(engine)}/settings`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  applySettings: (engine: DbServiceEngine, body?: { settings?: Record<string, unknown> }) =>
    api.requestRaw<Record<string, unknown>>(`${base(engine)}/settings/apply`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  install: (engine: DbServiceEngine) =>
    api.requestRaw<Record<string, unknown>>(`${base(engine)}/install`, {
      method: 'POST',
      body: '{}',
    }),
  start: (engine: DbServiceEngine) =>
    api.requestRaw<Record<string, unknown>>(`${base(engine)}/start`, {
      method: 'POST',
      body: '{}',
    }),
};
