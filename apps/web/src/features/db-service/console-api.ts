import { api } from '../../shared/services/api';
import type {
  DbServiceEngine,
  ServiceConsoleDto,
  ServiceConsoleCategoryDto,
  ServiceConsoleSettingDto,
} from '@ysk/shared';

/** @deprecated Prefer ServiceConsoleDto from @ysk/shared */
export type ConsoleSetting = ServiceConsoleSettingDto;
/** @deprecated Prefer ServiceConsoleCategoryDto from @ysk/shared */
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
  lifecycle: (engine: DbServiceEngine, action: string) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/system/db/${engine}/lifecycle`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  install: (engine: DbServiceEngine) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/system/db/${engine}/install`, {
      method: 'POST',
      body: '{}',
    }),
};
