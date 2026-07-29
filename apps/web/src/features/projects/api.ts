/**
 * Projects feature — API surface (wraps shared services).
 */
import type { OpsApplyResultDto, ProjectDto } from '@ysk/shared';
import { api } from '../../shared/services/api';

export const projectsApi = {
  list: () => api.listProjects(),
  create: (body: {
    name: string;
    domain?: string;
    domainAliases?: string[];
    runtime?: string;
    templateId?: string;
    createDnsZone?: boolean;
    createMailDomain?: boolean;
    serverIp?: string;
    serverIpv6?: string;
  }) => api.createProject(body),
  listTemplates: () => api.listTemplates(),
  applyTemplate: (id: string, body: { templateId: string; force?: boolean }) =>
    api.applyTemplate(id, body),
  wordpressDownload: (id: string, force?: boolean) =>
    api.wordpressDownload(id, { force }),
  remove: (id: string) => api.deleteProject(id),
  deploy: (
    id: string,
    body?: { entry?: string; skipBuild?: boolean; port?: number; nodeVersion?: string },
  ) => api.deployProject(id, body),
  deployPhp: (
    id: string,
    body?: { phpVersion?: string; preferFpm?: boolean; forceBuiltin?: boolean },
  ) =>
    api.requestRaw(`/api/v1/projects/${id}/deploy-php`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  setRuntimeVersion: (id: string, runtimeVersion: string) =>
    api.requestRaw<{ project: ProjectDto }>(`/api/v1/projects/${id}/runtime`, {
      method: 'PATCH',
      body: JSON.stringify({ runtimeVersion }),
    }),
  setDeployEntry: (id: string, deployEntry: string | null) =>
    api.requestRaw<{ project: ProjectDto }>(`/api/v1/projects/${id}/runtime`, {
      method: 'PATCH',
      body: JSON.stringify({ deployEntry }),
    }),
  deployHistory: (id: string, limit = 15) =>
    api.requestRaw<{
      items: Array<{
        id: string;
        actor: string;
        action: string;
        resource?: string;
        detail: unknown;
        ok: boolean;
        created_at: string;
      }>;
    }>(`/api/v1/projects/${id}/deploy-history?limit=${limit}`),
  applyPhpFpm: (id: string, body?: { phpVersion?: string; enable?: boolean }) =>
    api.requestRaw(`/api/v1/projects/${id}/php-fpm`, {
      method: 'POST',
      body: JSON.stringify(body ?? { enable: true }),
    }),
  phpIniGet: (id: string, version?: string) =>
    api.requestRaw<{
      version: string;
      catalog: Array<{
        id: string;
        title: string;
        fields: Array<{
          key: string;
          label: string;
          type: string;
          default: string | number | boolean;
          hint?: string;
          danger?: boolean;
          options?: Array<{ value: string; label: string }>;
        }>;
      }>;
      global: {
        values: Record<string, string | number | boolean>;
        extra: Record<string, string>;
      };
      project: {
        values: Record<string, string | number | boolean>;
        extra: Record<string, string>;
        rawAppend?: string;
      };
      effective: {
        values: Record<string, string | number | boolean>;
        extra: Record<string, string>;
      };
      adminValuePreview: string[];
      notes: string[];
    }>(
      `/api/v1/projects/${id}/php-ini${version ? `?version=${encodeURIComponent(version)}` : ''}`,
    ),
  phpIniSave: (
    id: string,
    body: {
      version?: string;
      values: Record<string, string | number | boolean>;
      extra?: Record<string, string>;
      rawAppend?: string;
    },
  ) =>
    api.requestRaw(`/api/v1/projects/${id}/php-ini`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  usage: (id: string) =>
    api.requestRaw<{
      usedMb: number;
      usedBytes: number;
      quotaMb: number | null;
      withinQuota: boolean | null;
      notes: string[];
    }>(`/api/v1/projects/${id}/usage`),
  stop: (id: string) => api.stopProject(id),
  health: (id: string) => api.projectHealth(id),
  /** Create/repair per-project Linux user + /home/ysk-server-{id} */
  osProvision: (id: string) =>
    api.requestRaw<{
      ok: boolean;
      osProvision: { attempted: boolean; ok: boolean; detail: string };
      requiresExecute?: boolean;
      requiresRoot?: boolean;
      homeDir?: string;
    }>(`/api/v1/projects/${id}/os-provision`, { method: 'POST', body: '{}' }),
  getOsUser: (id: string) =>
    api.requestRaw<{
      live: {
        linuxUser: string;
        linuxGroup: string;
        homeDir: string;
        canonicalHome: string;
        osProvisioned: boolean;
        userExists: boolean;
        uid?: number;
        gid?: number;
        shellLive?: string;
        homeExists: boolean;
        homeMode?: string;
        locked?: boolean | null;
        notes: string[];
      };
      limits: {
        quotaMb?: number;
        memoryMax?: string;
        cpuQuotaPercent?: number;
        tasksMax?: number;
        limitNofile?: number;
        shell?: string;
        accountLocked?: boolean;
      };
    }>(`/api/v1/projects/${id}/os-user`),
  patchOsUser: (
    id: string,
    body: {
      shell?: string;
      accountLocked?: boolean;
      memoryMax?: string;
      cpuQuotaPercent?: number;
      tasksMax?: number;
      limitNofile?: number;
      quotaMb?: number;
    },
  ) =>
    api.requestRaw<{
      ok: boolean;
      written?: boolean;
      applied?: boolean;
      blocked?: boolean;
      notes: string[];
    }>(`/api/v1/projects/${id}/os-user`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  applyOsLimits: (id: string) =>
    api.requestRaw<{
      ok: boolean;
      written?: boolean;
      applied?: boolean;
      blocked?: boolean;
      notes: string[];
    }>(`/api/v1/projects/${id}/os-user/apply-limits`, {
      method: 'POST',
      body: '{}',
    }),
  chownOsHome: (id: string) =>
    api.requestRaw<{ ok: boolean; notes: string[] }>(
      `/api/v1/projects/${id}/os-user/chown-home`,
      { method: 'POST', body: '{}' },
    ),
  migrateOsIsolation: (id: string, body?: { removePreviousHome?: boolean }) =>
    api.requestRaw<{
      ok: boolean;
      notes: string[];
      requiresExecute?: boolean;
      requiresRoot?: boolean;
      homeDir?: string;
      plan?: {
        needsMigration: boolean;
        targetHome: string;
        currentHome: string;
        reasons: string[];
      };
    }>(`/api/v1/projects/${id}/os-user/migrate`, {
      method: 'POST',
      body: JSON.stringify(body ?? { removePreviousHome: true }),
    }),

  publishNginx: (
    id: string,
    body?: { ssl?: boolean; forceHttps?: boolean; hsts?: boolean },
  ) => api.publishNginx(id, body),
  suspend: (id: string) => api.suspendProject(id),
  unsuspend: (id: string) => api.unsuspendProject(id),
  updateNetwork: (
    id: string,
    body: {
      domain?: string;
      domainAliases?: string[];
      forceHttps?: boolean;
      hsts?: boolean;
      siteRedirectUrl?: string | null;
      httpAuthUser?: string | null;
      httpAuthPass?: string | null;
      docRoot?: string | null;
      bindIp?: string | null;
      publish?: boolean;
      ssl?: boolean;
    },
  ) => api.updateProjectNetwork(id, body),
  purgeCache: (id: string) =>
    api.requestRaw<{ ok: boolean; notes?: string[]; blocked?: boolean }>(
      `/api/v1/projects/${id}/purge-cache`,
      { method: 'POST', body: '{}' },
    ),
  webStats: (id: string) =>
    api.requestRaw<{
      linesRead: number;
      status2xx: number;
      status4xx: number;
      status5xx: number;
      topPaths: Array<{ path: string; count: number }>;
      notes: string[];
      logPath?: string;
    }>(`/api/v1/projects/${id}/web-stats`),
  gitDeploy: (
    id: string,
    body?: {
      gitUrl?: string;
      redeploy?: boolean;
      entry?: string;
      skipBuild?: boolean;
    },
  ) => api.gitDeploy(id, body),
  setEnv: (id: string, env: Record<string, string>) => api.setProjectEnv(id, env),
  backup: (id: string) => api.backupProject(id),
  logs: (id: string, file?: string, lines = 80) => {
    const q = file
      ? `?file=${encodeURIComponent(file)}&lines=${lines}`
      : '';
    return api.requestRaw<{
      files: Array<{ name: string; bytes?: number; mtime?: string }>;
      tail?: { lines: string[]; file: string };
    }>(`/api/v1/projects/${id}/logs${q}`);
  },
  createFtp: (
    id: string,
    body: { username?: string; password: string; homeSubdir?: 'app' | 'root' },
  ) =>
    api.requestRaw<{
      ok: boolean;
      account?: Record<string, unknown>;
      notes?: string[];
    }>(`/api/v1/projects/${id}/ftp`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setQuota: (id: string, quotaMb: number) =>
    api.requestRaw<OpsApplyResultDto>(`/api/v1/projects/${id}/quota`, {
      method: 'POST',
      body: JSON.stringify({ quotaMb }),
    }),
  setResources: (
    id: string,
    body: {
      memoryMax?: string;
      cpuQuotaPercent?: number;
      tasksMax?: number;
      limitNofile?: number;
    },
  ) =>
    api.requestRaw<OpsApplyResultDto>(`/api/v1/projects/${id}/resources`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export type { ProjectDto, OpsApplyResultDto };
