import { api } from '../../shared/services/api';
import type {
  DbServiceEngine,
  ServiceConsoleDto,
  ServiceConsoleCategoryDto,
  ServiceConsoleSettingDto,
} from '@ysk-server/shared';

/** @deprecated Prefer ServiceConsoleDto from @ysk-server/shared */
export type ConsoleSetting = ServiceConsoleSettingDto;
/** @deprecated Prefer ServiceConsoleCategoryDto from @ysk-server/shared */
export type ConsoleCategory = ServiceConsoleCategoryDto;
/** SSOT: shared ServiceConsoleDto */
export type ServiceConsole = ServiceConsoleDto;

export const consoleApi = {
  get: (engine: DbServiceEngine) =>
    api.requestRaw<ServiceConsole>(`/api/v1/system/db/${engine}/console`),
  apply: (engine: DbServiceEngine, changes: Record<string, string>) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/system/db/${engine}/console/apply`, {
      method: 'POST',
      body: JSON.stringify({ changes }),
    }),
  lifecycle: (
    engine: DbServiceEngine,
    action: string,
    exposure?: {
      exposureDecision?: 'keep-private' | 'public' | 'restricted';
      allowFrom?: string[];
    },
  ) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/system/db/${engine}/lifecycle`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        ...(exposure?.exposureDecision
          ? {
              exposureDecision: exposure.exposureDecision,
              allowFrom: exposure.allowFrom,
            }
          : {}),
      }),
    }),
  install: (engine: DbServiceEngine) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/system/db/${engine}/install`, {
      method: 'POST',
      body: '{}',
    }),
};
