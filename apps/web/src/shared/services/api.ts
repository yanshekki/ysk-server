/**
 * All backend calls go through this shared services layer.
 */

import type { AuthLoginResponse, HealthResponse, ProjectDto } from '@ysk/shared';
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
