/**
 * All backend calls go through this shared services layer.
 */

import type { AuthLoginResponse, HealthResponse } from '@ysk/shared';

const base = '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
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
  me(token: string): Promise<{ user: { username: string; roles: string[] } }> {
    return request('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
  },
  status(): Promise<{ product: string; version: string; tools: string[] }> {
    return request('/api/v1/status');
  },
};
