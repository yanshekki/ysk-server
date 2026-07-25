/**
 * All backend calls go through this shared services layer.
 */

import type { AuthLoginResponse, HealthResponse, OpsApplyResultDto, ProjectDto } from '@ysk/shared';
import { authStore } from '../stores/auth-store';

const base = '';

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
  const data = (await res.json()) as T & { message?: string; code?: string };
  if (!res.ok) {
    throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return data;
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
    runtime?: string;
  }): Promise<{ project: ProjectDto; osProvision: unknown }> {
    return request('/api/v1/projects', { method: 'POST', body: JSON.stringify(body) });
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
  publishNginx(id: string, body?: { systemConfDir?: string; ssl?: boolean }): Promise<OpsApplyResultDto> {
    return request(`/api/v1/projects/${id}/publish-nginx`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
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
