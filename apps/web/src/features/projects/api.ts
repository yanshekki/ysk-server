/**
 * Projects feature — API surface (wraps shared services).
 */
import type { OpsApplyResultDto, ProjectDto } from '@ysk/shared';
import { api } from '../../shared/services/api';

export const projectsApi = {
  list: () => api.listProjects(),
  create: (body: { name: string; domain?: string; runtime?: string; templateId?: string }) =>
    api.createProject(body),
  listTemplates: () => api.listTemplates(),
  applyTemplate: (id: string, body: { templateId: string; force?: boolean }) =>
    api.applyTemplate(id, body),
  wordpressDownload: (id: string, force?: boolean) =>
    api.wordpressDownload(id, { force }),
  remove: (id: string) => api.deleteProject(id),
  deploy: (id: string) => api.deployProject(id),
  deployPhp: (id: string) => api.deployPhp(id),
  stop: (id: string) => api.stopProject(id),
  health: (id: string) => api.projectHealth(id),
  publishNginx: (id: string, body?: { ssl?: boolean }) => api.publishNginx(id, body),
  gitDeploy: (id: string, body?: { gitUrl?: string; redeploy?: boolean }) =>
    api.gitDeploy(id, body),
  setEnv: (id: string, env: Record<string, string>) => api.setProjectEnv(id, env),
  backup: (id: string) => api.backupProject(id),
  logs: (id: string, file?: string, lines = 80) => {
    const q = file
      ? `?file=${encodeURIComponent(file)}&lines=${lines}`
      : '';
    return api.requestRaw<{
      files: Array<{ name: string }>;
      tail?: { lines: string[]; file: string };
    }>(`/api/v1/projects/${id}/logs${q}`);
  },
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
