/**
 * All backend calls go through this shared services layer.
 */

import type { AuthLoginResponse, HealthResponse, OpsApplyResultDto, ProjectDto } from '@ysk/shared';
import i18n from '../lib/i18n';
import { authStore } from '../stores/auth-store';

const base = '';

/** API error with backend code + flags (L3). */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly needsTotp?: boolean;
  readonly locked?: boolean;
  readonly retryAfterSec?: number;
  readonly details?: unknown;

  constructor(
    message: string,
    opts: {
      status: number;
      code?: string;
      needsTotp?: boolean;
      locked?: boolean;
      retryAfterSec?: number;
      details?: unknown;
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.needsTotp = opts.needsTotp;
    this.locked = opts.locked;
    this.retryAfterSec = opts.retryAfterSec;
    this.details = opts.details;
  }
}

function localeHeader(): string {
  try {
    // Always send a supported tag so API runWithLocale matches UI language packs.
    const raw =
      i18n.language ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('ysk.locale') : null) ||
      'zh-HK';
    // Normalize en-US → en, zh-TW → zh-HK, etc.
    const lower = String(raw).toLowerCase();
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
    if (lower.includes('cn') || lower.includes('hans')) return 'zh-CN';
    if (lower.startsWith('zh')) return 'zh-HK';
    return 'zh-HK';
  } catch {
    return 'zh-HK';
  }
}

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
  if (status === 401) return i18n.t('errors.http.unauthorized');
  if (status === 403) return i18n.t('errors.http.forbidden');
  if (status === 404) return i18n.t('errors.http.notFound');
  if (status === 422) return i18n.t('errors.http.unprocessable');
  return i18n.t('errors.http.requestFailed', { status });
}

function throwFromResponse(data: unknown, status: number): never {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const details = o.details;
  const d =
    details && typeof details === 'object'
      ? (details as Record<string, unknown>)
      : {};
  throw new ApiError(errorMessageFromBody(data, status), {
    status,
    code: typeof o.code === 'string' ? o.code : undefined,
    needsTotp: Boolean(
      o.needsTotp ?? d.needsTotp ?? o.needsStepUp ?? d.needsStepUp,
    ),
    locked: Boolean(o.locked ?? d.locked),
    retryAfterSec:
      typeof o.retryAfterSec === 'number'
        ? o.retryAfterSec
        : typeof d.retryAfterSec === 'number'
          ? d.retryAfterSec
          : undefined,
    details: details ?? o,
  });
}

/** Paths that may return 401 without implying session death (login / public). */
function isAuthExemptPath(path: string): boolean {
  const p = path.split('?')[0] ?? path;
  return (
    p === '/api/v1/auth/login' ||
    p.startsWith('/api/v1/auth/webauthn/login') ||
    p === '/health' ||
    p === '/api/v1/health' ||
    p === '/api/v1/readiness' ||
    p === '/api/v1/status'
  );
}

let sessionLogoutInFlight = false;

/**
 * On 401 with a stored token: clear session and hard-redirect to login.
 * Avoids pages stuck showing "Session expired" install banners.
 */
function forceLogoutOnSessionExpired(path: string): void {
  if (isAuthExemptPath(path)) return;
  if (!authStore.getToken()) return;
  if (sessionLogoutInFlight) return;
  sessionLogoutInFlight = true;
  try {
    authStore.clear();
  } catch {
    /* ignore */
  }
  try {
    const from =
      typeof window !== 'undefined'
        ? window.location.pathname + window.location.search
        : '/';
    const q = new URLSearchParams({
      reason: 'session',
      from: from === '/login' ? '/' : from,
    });
    // Full navigation clears React state (install panels, feature hooks, etc.)
    window.location.assign(`/login?${q.toString()}`);
  } catch {
    try {
      window.location.href = '/login?reason=session';
    } catch {
      /* ignore */
    }
  }
}

function handleResponseStatus(path: string, status: number, data: unknown): void {
  if (status === 401) {
    forceLogoutOnSessionExpired(path);
  }
  if (status >= 400) {
    throwFromResponse(data, status);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = authStore.getToken();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': localeHeader(),
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
    handleResponseStatus(path, res.status, data);
  }
  return data as T;
}

export const api = {
  requestRaw<T>(path: string, init?: RequestInit): Promise<T> {
    return request<T>(path, init);
  },
  /**
   * Like requestRaw, but treat listed HTTP statuses as success (body still returned).
   * Used by readiness: 503 = not production-ready, payload is still the full report.
   */
  async requestRawAllowStatus<T>(
    path: string,
    opts?: RequestInit & { allowStatuses?: number[] },
  ): Promise<T> {
    const { allowStatuses = [], ...init } = opts ?? {};
    const token = authStore.getToken();
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': localeHeader(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    let data: unknown = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok && !allowStatuses.includes(res.status)) {
      handleResponseStatus(path, res.status, data);
    }
    return data as T;
  },
  /**
   * Authenticated binary download (Bearer). Saves via blob + object URL.
   * Do not use window.open — it will not send Authorization.
   */
  async downloadAuthenticated(path: string, filename: string): Promise<void> {
    const token = authStore.getToken();
    const res = await fetch(`${base}${path}`, {
      headers: {
        'Accept-Language': localeHeader(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      let data: unknown = {};
      try {
        data = await res.json();
      } catch {
        /* ignore */
      }
      handleResponseStatus(path, res.status, data);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  health(): Promise<HealthResponse> {
    return request<HealthResponse>('/health');
  },
  login(
    username: string,
    password: string,
    totp?: string,
  ): Promise<AuthLoginResponse> {
    return request<AuthLoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, totp }),
    });
  },
  logout(): Promise<{ ok: boolean }> {
    return request('/api/v1/auth/logout', { method: 'POST' });
  },
  me(): Promise<{
    user: {
      id?: string;
      username: string;
      roles: string[];
      locale: string;
      capabilities?: string[];
    };
    capabilities?: string[];
  }> {
    return request('/api/v1/auth/me');
  },
  /** Persist UI language for the signed-in user (Accept-Language still used per request). */
  setLocale(locale: string): Promise<{
    ok: boolean;
    user: { id: string; username: string; roles: string[]; locale: string };
  }> {
    return request('/api/v1/auth/locale', {
      method: 'PATCH',
      body: JSON.stringify({ locale }),
    });
  },
  totpStatus(): Promise<{
    enabled: boolean;
    enrolled: boolean;
    recoveryRemaining?: number;
  }> {
    return request('/api/v1/auth/totp');
  },
  totpBegin(opts?: {
    password?: string;
    totp?: string;
  }): Promise<{ secret: string; otpauthUrl: string; enabled: boolean }> {
    return request('/api/v1/auth/totp/begin', {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    });
  },
  listSessions(): Promise<{
    items: Array<{
      id: string;
      created_at: string;
      expires_at: string;
      last_seen_at?: string;
      user_agent?: string;
      ip?: string;
      current?: boolean;
    }>;
  }> {
    return request('/api/v1/auth/sessions');
  },
  revokeSession(id: string): Promise<{ ok: boolean }> {
    return request(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  revokeOtherSessions(): Promise<{ ok: boolean; revoked: number }> {
    return request('/api/v1/auth/sessions', { method: 'DELETE' });
  },
  getSecuritySettings(): Promise<{
    requireAdminTotp: boolean;
    requireAdminTotpStrict: boolean;
  }> {
    return request('/api/v1/settings/security');
  },
  setSecuritySettings(body: {
    requireAdminTotp?: boolean;
    requireAdminTotpStrict?: boolean;
    totp?: string;
  }): Promise<{
    ok: boolean;
    requireAdminTotp: boolean;
    requireAdminTotpStrict: boolean;
  }> {
    return request('/api/v1/settings/security', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  totpConfirm(code: string): Promise<{ enabled: boolean; recoveryCodes?: string[] }> {
    return request('/api/v1/auth/totp/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },
  totpStepUp(code: string): Promise<{ ok: boolean }> {
    return request('/api/v1/auth/totp/step-up', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  totpDisable(code: string): Promise<{ enabled: boolean }> {
    return request('/api/v1/auth/totp/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },
  listApiKeys(): Promise<{
    items: Array<{ id: string; name: string; prefix: string; created_at: string }>;
  }> {
    return request('/api/v1/auth/api-keys');
  },
  createApiKey(name: string): Promise<{
    key: { id: string; name: string; prefix: string; created_at: string };
    token: string;
  }> {
    return request('/api/v1/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },
  deleteApiKey(id: string): Promise<{ ok: boolean }> {
    return request(`/api/v1/auth/api-keys/${id}`, { method: 'DELETE' });
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
    runtimeVersion?: string;
    templateId?: string;
    createDnsZone?: boolean;
    createMailDomain?: boolean;
    serverIp?: string;
    serverIpv6?: string;
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
  deleteProject(
    id: string,
    body?: { confirmName: string; removeFiles?: boolean },
  ): Promise<{
    ok: boolean;
    projectId?: string;
    removedFiles?: boolean;
    notes?: string[];
    warnings?: string[];
  }> {
    return request(`/api/v1/projects/${id}`, {
      method: 'DELETE',
      body: JSON.stringify(body ?? {}),
    });
  },
  getProject(id: string): Promise<{ project: ProjectDto }> {
    return request(`/api/v1/projects/${id}`);
  },
  /** Real Node deploy: spawn + pidfile + listen + HTTP health */
  deployProject(
    id: string,
    body?: {
      port?: number;
      entry?: string;
      skipBuild?: boolean;
      nodeVersion?: string;
      enableSystemd?: boolean;
    },
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
      siteRedirectUrl?: string | null;
      httpAuthUser?: string | null;
      httpAuthPass?: string | null;
      docRoot?: string | null;
      bindIp?: string | null;
      realIpProvider?: string | null;
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
    body?: {
      gitUrl?: string;
      branch?: string;
      redeploy?: boolean;
      entry?: string;
      skipBuild?: boolean;
    },
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
  runCronNow(id: string): Promise<Record<string, unknown>> {
    return request(`/api/v1/cron/${id}/run`, { method: 'POST', body: '{}' });
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
