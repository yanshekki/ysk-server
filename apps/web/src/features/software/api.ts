/**
 * Unified one-click software install API + stack plan wizard
 */
import type { SoftwareStatus, SoftwareInstallResult } from '@ysk/shared';
import { api } from '../../shared/services/api';

export type { SoftwareStatus, SoftwareInstallResult } from '@ysk/shared';

export type StackPlan = {
  id: string;
  title: string;
  titleZh?: string;
  description?: string;
  bundles: string[];
};

export type StackBundle = {
  id: string;
  title: string;
  titleZh?: string;
  description?: string;
  components: string[];
  required?: boolean;
};

export type StackStatusResponse = {
  ok: boolean;
  manifest: {
    plan: string;
    bundles: string[];
    components: Record<string, unknown>;
    dataDir?: string;
  };
  components: Array<{
    id: string;
    title: string;
    inManifest: boolean;
    installed: boolean;
    bins: string[];
  }>;
  plans: StackPlan[];
  bundles: StackBundle[];
  executeEnabled?: boolean;
  isRoot?: boolean;
};

export type StackOpResult = SoftwareInstallResult & {
  dryRun?: boolean;
  plan?: string;
  bundles?: string[];
  components?: string[];
  dataPolicy?: string;
  steps?: Array<{ name: string; status: string; detail?: string }>;
  notes?: string[];
};

export type SqlSwitchPreview = {
  ok: boolean;
  currentFlavor: 'mysql' | 'mariadb' | 'none';
  target: 'mysql' | 'mariadb';
  needsSwitch: boolean;
  canProceed: boolean;
  blockReason?: string;
  databases: Array<{ name: string; tableCount?: number }>;
  warnings: string[];
  confirmPhrase: string;
  dataDirHint: string;
};

export type SqlSwitchResult = SoftwareInstallResult & {
  dumpPath?: string;
  oldDatadirBackup?: string;
  code?: string;
  steps?: Array<{ name: string; status: string; detail?: string }>;
};

export const softwareApi = {
  list: (feature?: string) => {
    const q = feature ? `?feature=${encodeURIComponent(feature)}` : '';
    return api.requestRaw<{
      items: SoftwareStatus[];
      missing: SoftwareStatus[];
      ready: boolean;
    }>(`/api/v1/system/software${q}`);
  },
  installOne: (id: string) =>
    api.requestRaw<SoftwareInstallResult>(`/api/v1/system/software/${id}/install`, {
      method: 'POST',
      body: '{}',
    }),
  installMany: (ids: string[]) =>
    api.requestRaw<SoftwareInstallResult>('/api/v1/system/software/install', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  installFeature: (feature: string) =>
    api.requestRaw<SoftwareInstallResult>('/api/v1/system/software/install', {
      method: 'POST',
      body: JSON.stringify({ feature }),
    }),

  /** Preview MySQL ↔ MariaDB exclusive switch (no mutation) */
  sqlEngineSwitchPreview: (target: 'mysql' | 'mariadb') =>
    api.requestRaw<SqlSwitchPreview>(
      `/api/v1/system/db/sql-engine/switch-preview?target=${encodeURIComponent(target)}`,
    ),

  /** Confirmed exclusive switch with data migration */
  sqlEngineSwitch: (body: {
    target: 'mysql' | 'mariadb';
    confirmPhrase: string;
    acknowledgeExclusive: boolean;
    migrateData?: boolean;
  }) =>
    api.requestRaw<SqlSwitchResult>('/api/v1/system/db/sql-engine/switch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  stackStatus: () => api.requestRaw<StackStatusResponse>('/api/v1/system/stack'),
  stackPlans: () =>
    api.requestRaw<{ ok: boolean; plans: StackPlan[]; bundles: StackBundle[] }>(
      '/api/v1/system/stack/plans',
    ),
  stackExpand: (body: {
    plan?: string;
    bundles?: string[];
    sqlServer?: 'mariadb' | 'mysql';
    clamav?: boolean;
  }) =>
    api.requestRaw<{
      ok: boolean;
      plan?: string;
      bundles?: string[];
      components?: string[];
      error?: string;
    }>('/api/v1/system/stack/expand', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  stackInstall: (body: {
    plan?: string;
    bundles?: string[];
    sqlServer?: 'mariadb' | 'mysql';
    clamav?: boolean;
    dryRun?: boolean;
  }) =>
    api.requestRaw<StackOpResult>('/api/v1/system/stack/install', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  stackUninstall: (body: {
    all?: boolean;
    bundles?: string[];
    components?: string[];
    dataPolicy?: 'keep' | 'purge';
    removeProduct?: boolean;
    dryRun?: boolean;
  }) =>
    api.requestRaw<StackOpResult>('/api/v1/system/stack/uninstall', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  stackScan: () =>
    api.requestRaw<{ ok: boolean; manifest: StackStatusResponse['manifest']; notes: string[] }>(
      '/api/v1/system/stack/scan',
      { method: 'POST', body: '{}' },
    ),
};
