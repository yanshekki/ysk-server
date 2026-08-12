/**
 * MySQL / MariaDB engine status + install + start
 */
import { api } from '../../shared/services/api';
import type { DbEngineKind, DbEngineStatus } from '@ysk-server/shared';

export type { DbEngineKind, DbEngineStatus } from '@ysk-server/shared';

export const dbEngineApi = {
  status: (engine: DbEngineKind) =>
    api.requestRaw<DbEngineStatus>(`/api/v1/system/db/${engine}/status`),
  install: (engine: DbEngineKind) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/system/db/${engine}/install`, {
      method: 'POST',
      body: '{}',
    }),
  start: (
    engine: DbEngineKind,
    exposure?: {
      exposureDecision?: 'keep-private' | 'public' | 'restricted';
      allowFrom?: string[];
    },
  ) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/system/db/${engine}/start`, {
      method: 'POST',
      body: JSON.stringify({
        ...(exposure?.exposureDecision
          ? {
              exposureDecision: exposure.exposureDecision,
              allowFrom: exposure.allowFrom,
            }
          : {}),
      }),
    }),
  /** Confirm-clear Debian FROZEN + re-init empty datadir + start */
  unfreeze: (engine: DbEngineKind, confirm: boolean) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/system/db/${engine}/unfreeze`, {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    }),
};
