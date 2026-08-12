/**
 * Unified one-click software install API + stack plan wizard
 */
import type { SoftwareStatus, SoftwareInstallResult } from 'ysk-server-shared';
import { api } from '../../shared/services/api';

export type { SoftwareStatus, SoftwareInstallResult } from 'ysk-server-shared';

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
  /** @deprecated UI uses warningKeys + i18n */
  warnings: string[];
  /** Stable keys → sqlEngineSwitch.warn.* */
  warningKeys?: string[];
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
    api.requestRawAllowStatus<SoftwareInstallResult>(
      `/api/v1/system/software/${id}/install`,
      {
        method: 'POST',
        body: '{}',
        allowStatuses: [403, 422],
      },
    ),
  installMany: (ids: string[]) =>
    api.requestRawAllowStatus<SoftwareInstallResult>('/api/v1/system/software/install', {
      method: 'POST',
      body: JSON.stringify({ ids }),
      allowStatuses: [403, 422],
    }),
  installFeature: (feature: string) =>
    api.requestRawAllowStatus<SoftwareInstallResult>('/api/v1/system/software/install', {
      method: 'POST',
      body: JSON.stringify({ feature }),
      allowStatuses: [403, 422],
    }),
  installFeatureStream: (
    feature: string,
    opts?: {
      onLog?: (line: {
        stream: 'stdout' | 'stderr' | 'status';
        line: string;
      }) => void;
      signal?: AbortSignal;
    },
  ) =>
    import('../runtimes/stream-sse').then(async (m) => {
      const { ops, raw } = await m.postSseJson(
        '/api/v1/system/software/install',
        { feature, stream: true },
        opts,
      );
      return { ops, raw };
    }),
  uninstallPreview: (body: {
    feature?: string;
    ids?: string[];
    dataPolicy?: 'keep' | 'purge';
  }) =>
    api.requestRaw<{
      ok: boolean;
      targets: Array<{
        id: string;
        title: string;
        installed: boolean;
        packages: string[];
        units: string[];
        dataPaths: string[];
        impactKeys: string[];
        protected: boolean;
      }>;
      summary: {
        packageCount: number;
        unitCount: number;
        installedCount: number;
        willStopServices: boolean;
        willTouchData: boolean;
      };
      warningKeys: string[];
      confirmPhrase: string;
      notes?: string[];
      blocked?: boolean;
      blockMessage?: string;
    }>('/api/v1/system/software/uninstall-preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  uninstallStream: (
    body: {
      feature?: string;
      ids?: string[];
      dataPolicy?: 'keep' | 'purge';
      confirmPhrase: string;
    },
    opts?: {
      onLog?: (line: {
        stream: 'stdout' | 'stderr' | 'status';
        line: string;
      }) => void;
      signal?: AbortSignal;
    },
  ) =>
    import('../runtimes/stream-sse').then(async (m) => {
      const { ops, raw } = await m.postSseJson(
        '/api/v1/system/software/uninstall',
        { ...body, stream: true },
        opts,
      );
      return { ops, raw };
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
