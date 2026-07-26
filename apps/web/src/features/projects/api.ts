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
  }) => api.createProject(body),
  listTemplates: () => api.listTemplates(),
  applyTemplate: (id: string, body: { templateId: string; force?: boolean }) =>
    api.applyTemplate(id, body),
  wordpressDownload: (id: string, force?: boolean) =>
    api.wordpressDownload(id, { force }),
  remove: (id: string) => api.deleteProject(id),
  deploy: (id: string) => api.deployProject(id),
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
  applyPhpFpm: (id: string, body?: { phpVersion?: string; enable?: boolean }) =>
    api.requestRaw(`/api/v1/projects/${id}/php-fpm`, {
      method: 'POST',
      body: JSON.stringify(body ?? { enable: true }),
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
      publish?: boolean;
      ssl?: boolean;
    },
  ) => api.updateProjectNetwork(id, body),
  gitDeploy: (id: string, body?: { gitUrl?: string; redeploy?: boolean }) =>
    api.gitDeploy(id, body),
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
  setResources: (id: string, body: { memoryMax?: string; cpuQuotaPercent?: number }) =>
    api.requestRaw<OpsApplyResultDto>(`/api/v1/projects/${id}/resources`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export type { ProjectDto, OpsApplyResultDto };
