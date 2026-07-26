/**
 * All backend calls go through this shared services layer.
 */

import type { AuthLoginResponse, HealthResponse, OpsApplyResultDto, ProjectDto } from '@ysk/shared';
import { authStore } from '../stores/auth-store';

const base = '';

function errorMessageFromBody(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (typeof o.blockMessage === 'string' && o.blockMessage.trim()) return o.blockMessage;
    if (typeof o.message === 'string' && o.message.trim()) return o.message;
    if (Array.isArray(o.notes) && o.notes.length) {
      const n = o.notes.map(String).find((x) => x.trim());
      if (n) return n;
    }
    if (Array.isArray(o.results)) {
      for (const r of o.results) {
        if (r && typeof r === 'object') {
          const row = r as Record<string, unknown>;
          if (typeof row.blockMessage === 'string' && row.blockMessage.trim()) {
            return row.blockMessage;
          }
          if (Array.isArray(row.notes) && row.notes[0]) return String(row.notes[0]);
        }
      }
    }
  }
  if (status === 401) return '未登入或工作階段已過期';
  if (status === 403) return '沒有權限執行此操作';
  if (status === 404) return '找不到資源';
  if (status === 422) return '操作無法完成（伺服器拒絕）';
  return `請求失敗（${status}）`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = authStore.getToken();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(errorMessageFromBody(data, res.status));
  }
  return data as T;
}

export const api = {
  requestRaw<T>(path: string, init?: RequestInit): Promise<T> {
    return request<T>(path, init);
  },
  health(): Promise<HealthResponse> {
    return request<HealthResponse>('/health');
  },
  login(username: string, password: string): Promise<AuthLoginResponse> {
    return request<AuthLoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  logout(): Promise<{ ok: boolean }> {
    return request('/api/v1/auth/logout', { method: 'POST' });
  },
  me(): Promise<{ user: { username: string; roles: string[]; locale: string } }> {
    return request('/api/v1/auth/me');
  },
  status(): Promise<{ product: string; version: string; tools: string[]; executeEnabled: boolean }> {
    return request('/api/v1/status');
  },
  listProjects(): Promise<{ items: ProjectDto[] }> {
    return request('/api/v1/projects');
  },
  createProject(body: {
    name: string;
    domain?: string;
    domainAliases?: string[];
    runtime?: string;
    templateId?: string;
    createDnsZone?: boolean;
    createMailDomain?: boolean;
    serverIp?: string;
  }): Promise<{
    project: ProjectDto;
    osProvision: unknown;
    scaffold?: unknown;
    extras?: { dnsZoneId?: string; emailDomainId?: string; notes: string[] };
  }> {
    return request('/api/v1/projects', { method: 'POST', body: JSON.stringify(body) });
  },
  listTemplates(): Promise<{
    items: Array<{ id: string; name: string; description: string; runtime: string }>;
  }> {
    return request('/api/v1/templates');
  },
  applyTemplate(
    id: string,
    body: { templateId: string; force?: boolean },
  ): Promise<{ project: ProjectDto; scaffold: unknown }> {
    return request(`/api/v1/projects/${id}/template`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  wordpressDownload(id: string, body?: { force?: boolean }): Promise<Record<string, unknown>> {
    return request(`/api/v1/projects/${id}/wordpress-download`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
  },
  provisionPostgres(body: {
    dbName: string;
    username: string;
    password: string;
    host?: string;
    port?: number;
    execute?: boolean;
  }): Promise<Record<string, unknown>> {
    return request('/api/v1/hosting/db/postgres-provision', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  provisionRedis(body: {
    projectId?: string;
    dbIndex?: number;
    execute?: boolean;
  }): Promise<Record<string, unknown>> {
    return request('/api/v1/hosting/db/redis-provision', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  deleteProject(id: string): Promise<{ ok: boolean }> {
    return request(`/api/v1/projects/${id}`, { method: 'DELETE' });
  },
  getProject(id: string): Promise<{ project: ProjectDto }> {
    return request(`/api/v1/projects/${id}`);
  },
  /** Real Node deploy: spawn + pidfile + listen + HTTP health */
  deployProject(
    id: string,
    body?: { port?: number; entry?: string; nodeVersion?: string },
  ): Promise<OpsApplyResultDto> {
    return request(`/api/v1/projects/${id}/deploy`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
  },
  stopProject(id: string): Promise<OpsApplyResultDto> {
    return request(`/api/v1/projects/${id}/stop`, { method: 'POST', body: '{}' });
  },
  projectHealth(id: string): Promise<OpsApplyResultDto> {
    return request(`/api/v1/projects/${id}/health`);
  },
  publishNginx(
    id: string,
    body?: {
      systemConfDir?: string;
      ssl?: boolean;
      reload?: boolean;
      forceHttps?: boolean;
      hsts?: boolean;
    },
  ): Promise<OpsApplyResultDto> {
    return request(`/api/v1/projects/${id}/publish-nginx`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
  },
  suspendProject(id: string): Promise<OpsApplyResultDto> {
    return request(`/api/v1/projects/${id}/suspend`, { method: 'POST', body: '{}' });
  },
  unsuspendProject(id: string): Promise<OpsApplyResultDto> {
    return request(`/api/v1/projects/${id}/unsuspend`, { method: 'POST', body: '{}' });
  },
  updateProjectNetwork(
    id: string,
    body: {
      domain?: string;
      domainAliases?: string[];
      forceHttps?: boolean;
      hsts?: boolean;
      publish?: boolean;
      ssl?: boolean;
    },
  ): Promise<{ project: ProjectDto; publish?: OpsApplyResultDto }> {
    return request(`/api/v1/projects/${id}/network`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  gitDeploy(
    id: string,
    body?: { gitUrl?: string; branch?: string; redeploy?: boolean },
  ): Promise<OpsApplyResultDto> {
    return request(`/api/v1/projects/${id}/git-deploy`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
  },
  setProjectEnv(id: string, env: Record<string, string>): Promise<OpsApplyResultDto> {
    return request(`/api/v1/projects/${id}/env`, {
      method: 'POST',
      body: JSON.stringify({ env }),
    });
  },
  backupProject(id: string): Promise<OpsApplyResultDto & { archivePath?: string }> {
    return request(`/api/v1/projects/${id}/backup`, { method: 'POST', body: '{}' });
  },
  deployPhp(
    id: string,
    body?: { port?: number; phpVersion?: string; enableApache?: boolean },
  ): Promise<OpsApplyResultDto> {
    return request(`/api/v1/projects/${id}/deploy-php`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
  },
  listCron(projectId?: string): Promise<{ items: Array<Record<string, unknown>> }> {
    const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return request(`/api/v1/cron${q}`);
  },
  createCron(body: {
    projectId?: string;
    user?: string;
    schedule: string;
    command: string;
  }): Promise<{ job: Record<string, unknown> }> {
    return request('/api/v1/cron', { method: 'POST', body: JSON.stringify(body) });
  },
  installCron(): Promise<{
    ok: boolean;
    notes: string[];
    path: string;
    blocked?: boolean;
    hostInstalled?: boolean;
  }> {
    return request('/api/v1/cron/install', { method: 'POST', body: '{}' });
  },
  cronStatus(): Promise<{
    managedPath: string;
    managedLines: number;
    enabledJobs: number;
    totalJobs: number;
    hostHasYskEntries: boolean | null;
    hostCrontabPreview: string;
    executeEnabled: boolean;
    lastInstallOk: boolean | null;
    lastInstallAt: string | null;
  }> {
    return request('/api/v1/cron/status');
  },
  listSslCertificates(): Promise<{ items: Array<Record<string, unknown>> }> {
    return request('/api/v1/system/ssl/certificates');
  },
  listApprovals(): Promise<{ items: Array<Record<string, unknown>> }> {
    return request('/api/v1/approvals?status=pending');
  },
  approve(id: string): Promise<unknown> {
    return request(`/api/v1/approvals/${id}/approve`, { method: 'POST' });
  },
  audit(): Promise<{ items: Array<Record<string, unknown>> }> {
    return request('/api/v1/audit');
  },
  executeTool(body: {
    tool: string;
    args?: Record<string, unknown>;
    dryRun?: boolean;
    approvalId?: string;
  }): Promise<Record<string, unknown>> {
    return request('/api/v1/tools/execute', { method: 'POST', body: JSON.stringify(body) });
  },
  listTools(): Promise<{ items: Array<Record<string, unknown>> }> {
    return request('/api/v1/tools');
  },
};
