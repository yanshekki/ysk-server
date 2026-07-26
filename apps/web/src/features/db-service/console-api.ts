import { api } from '../../shared/services/api';
import type { DbServiceEngine } from './api';

export type ConsoleSetting = {
  key: string;
  label: string;
  category: string;
  type: string;
  unit?: string;
  enumValues?: string[];
  description?: string;
  applyMode: string;
  liveValue?: string;
  danger?: boolean;
  advanced?: boolean;
};

export type ConsoleCategory = {
  id: string;
  label: string;
  description: string;
  settings: ConsoleSetting[];
};

export type ServiceConsole = {
  engine: DbServiceEngine;
  title: string;
  version?: string;
  unit: string;
  active: string;
  activeLabel: string;
  enabled?: string;
  installed: boolean;
  executeEnabled: boolean;
  isRoot: boolean;
  canLifecycle: boolean;
  blockMessage?: string;
  metrics: Record<string, string>;
  categories: ConsoleCategory[];
  live: Record<string, string>;
};

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
