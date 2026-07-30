/**
 * Host full-migrate API client.
 */
import { api } from '../../shared/services/api';

export type MigrateJob = {
  id: string;
  phase: string;
  target?: { host: string; port: number; user: string; identityId?: string };
  targetDataDir: string;
  forceWipeTarget?: boolean;
  maintenanceAccepted?: boolean;
  manifest?: {
    counts?: Record<string, number>;
    warnings?: string[];
    cutoverHostnames?: string[];
    softwareNeeded?: string[];
    projects?: unknown[];
    packagedAt?: string;
  };
  steps?: Array<{
    id: string;
    phase: string;
    name: string;
    at: string;
    result: { ok: boolean; notes?: string[]; blocked?: boolean };
  }>;
  verify?: {
    productionReady?: boolean;
    mismatches: string[];
    notes: string[];
  };
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

export type MigrateOpsResult = {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  apply_status?: string;
  notes: string[];
  requiresExecute?: boolean;
  job?: MigrateJob;
  manifest?: MigrateJob['manifest'] & Record<string, unknown>;
  summary?: string[];
  phases?: Record<string, { ok?: boolean; notes?: string[] }>;
};

export const migrateApi = {
  inventory: () =>
    api.requestRaw<MigrateOpsResult>('/api/v1/system/migrate/inventory', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  listJobs: () =>
    api.requestRaw<{ ok: boolean; jobs: MigrateJob[] }>(
      '/api/v1/system/migrate/jobs',
    ),

  getJob: (id: string) =>
    api.requestRaw<{ ok: boolean; job: MigrateJob }>(
      `/api/v1/system/migrate/jobs/${encodeURIComponent(id)}`,
    ),

  /**
   * Create/run source migrate. Password is one-shot (never re-fetched).
   */
  runHost: (body: {
    target: string;
    port?: number;
    identityId?: string;
    identityFile?: string;
    password?: string;
    maintenanceAccepted?: boolean;
    forceWipeTarget?: boolean;
    targetDataDir?: string;
    dryRun?: boolean;
    skipRemotePost?: boolean;
    jobId?: string;
    execute?: boolean;
  }) =>
    api.requestRaw<MigrateOpsResult>('/api/v1/system/migrate/jobs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  postLocal: (jobId: string) =>
    api.requestRaw<MigrateOpsResult>('/api/v1/system/migrate/post', {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    }),
};
