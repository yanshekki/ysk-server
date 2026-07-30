/**
 * MySQL / MariaDB engine status + install + start
 */
import { api } from '../../shared/services/api';
import type { DbEngineKind, DbEngineStatus } from '@ysk/shared';

export type { DbEngineKind, DbEngineStatus } from '@ysk/shared';

export const dbEngineApi = {
  status: (engine: DbEngineKind) =>
    api.requestRaw<DbEngineStatus>(`/api/v1/system/db/${engine}/status`),
  install: (engine: DbEngineKind) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/system/db/${engine}/install`, {
      method: 'POST',
      body: '{}',
    }),
  start: (engine: DbEngineKind) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/system/db/${engine}/start`, {
      method: 'POST',
      body: '{}',
    }),
};
