import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, localeHeaderFrom } from './api';
import { authStore } from '../stores/auth-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

describe('api service layer', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    authStore.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('localeHeaderFrom keeps ja/ko/fr (not zh-HK)', () => {
    expect(localeHeaderFrom('ja')).toBe('ja');
    expect(localeHeaderFrom('ko-KR')).toBe('ko');
    expect(localeHeaderFrom('fr-FR')).toBe('fr');
    expect(localeHeaderFrom('en-US')).toBe('en');
    expect(localeHeaderFrom('zh-TW')).toBe('zh-HK');
  });

  it('exposes health and login entry points', () => {
    expect(typeof api.health).toBe('function');
    expect(typeof api.login).toBe('function');
    expect(typeof api.me).toBe('function');
    expect(typeof api.status).toBe('function');
  });

  it('sends Authorization when token is set', async () => {
    authStore.setToken('tok-abc');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await api.requestRaw('/api/v1/status');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-abc');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept-Language']).toBeTruthy();
  });

  it('returns JSON body on success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ product: 'ysk', version: '1.0' }));
    const r = await api.status();
    expect(r.product).toBe('ysk');
    expect(r.version).toBe('1.0');
  });

  it('treats non-JSON body as empty object on success', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('not-json', 200));
    const r = await api.requestRaw<Record<string, unknown>>('/health');
    expect(r).toEqual({});
  });

  it('throws ApiError with message from body.message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: 'Bad credentials', code: 'YSK_AUTH' }, 401),
    );
    await expect(api.login('a', 'b')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'Bad credentials',
      code: 'YSK_AUTH',
    });
  });

  it('prefers blockMessage over message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ blockMessage: 'Host execute off', message: 'ignored' }, 403),
    );
    await expect(api.requestRaw('/api/v1/tools/execute')).rejects.toMatchObject({
      message: 'Host execute off',
      status: 403,
    });
  });

  it('uses notes[] when message is missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ notes: ['  ', 'first note'] }, 422));
    await expect(api.requestRaw('/api/v1/x')).rejects.toMatchObject({
      message: 'first note',
      status: 422,
    });
  });

  it('does not toast npm channel probe as the apply error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          notes: ['npm 頻道：ysk-server@1.0.10', '找不到執行中安裝目錄'],
        },
        422,
      ),
    );
    await expect(api.requestRaw('/api/v1/updates/self/apply')).rejects.toMatchObject({
      message: '找不到執行中安裝目錄',
      status: 422,
    });
  });

  it('pulls blockMessage from results[] rows', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ results: [{ notes: [] }, { blockMessage: 'row blocked' }] }, 400),
    );
    await expect(api.requestRaw('/api/v1/batch')).rejects.toMatchObject({
      message: 'row blocked',
    });
  });

  it('falls back to i18n http error when body is empty (401)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    try {
      await api.login('u', 'p');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(401);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it('maps 403/404 status fallbacks when no body message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 403));
    await expect(api.requestRaw('/api/v1/secret')).rejects.toMatchObject({ status: 403 });

    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(api.requestRaw('/api/v1/missing')).rejects.toMatchObject({ status: 404 });
  });

  it('parses needsTotp / locked / retryAfterSec from body and details', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: '2FA',
          needsTotp: true,
          locked: true,
          retryAfterSec: 30,
          code: 'YSK_TOTP_REQUIRED',
        },
        401,
      ),
    );
    try {
      await api.login('a', 'b');
      expect.unreachable();
    } catch (e) {
      const err = e as ApiError;
      expect(err.needsTotp).toBe(true);
      expect(err.locked).toBe(true);
      expect(err.retryAfterSec).toBe(30);
      expect(err.code).toBe('YSK_TOTP_REQUIRED');
    }

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: 'nested',
          details: { needsTotp: true, retryAfterSec: 12 },
        },
        401,
      ),
    );
    try {
      await api.login('a', 'b');
      expect.unreachable();
    } catch (e) {
      const err = e as ApiError;
      expect(err.needsTotp).toBe(true);
      expect(err.retryAfterSec).toBe(12);
    }
  });

  it('does not force-logout on 401 for auth-exempt paths', async () => {
    authStore.setToken('live-token');
    const assign = vi.fn();
    vi.stubGlobal('location', {
      ...window.location,
      assign,
      pathname: '/projects',
      search: '',
      href: '',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'bad login' }, 401));
    await expect(api.login('x', 'y')).rejects.toBeInstanceOf(ApiError);
    expect(authStore.getToken()).toBe('live-token');
    expect(assign).not.toHaveBeenCalled();
  });

  it('force-logouts on 401 when token present on protected path', async () => {
    authStore.setSession('sess-token', {
      username: 'admin',
      roles: ['admin'],
    });
    const assign = vi.fn();
    vi.stubGlobal('location', {
      pathname: '/projects',
      search: '',
      href: '',
      assign,
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401));
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(authStore.getToken()).toBeNull();
    expect(assign).toHaveBeenCalled();
    const url = String(assign.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('/login?');
    expect(url).toContain('reason=session');
  });

  it('requestRawAllowStatus returns body for allowed error statuses', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ready: false, score: 12 }, 503),
    );
    const r = await api.requestRawAllowStatus<{ ready: boolean; score: number }>(
      '/api/v1/readiness',
      { allowStatuses: [503] },
    );
    expect(r.ready).toBe(false);
    expect(r.score).toBe(12);
  });

  it('requestRawAllowStatus still throws for non-allowed statuses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 500));
    await expect(
      api.requestRawAllowStatus('/api/v1/readiness', { allowStatuses: [503] }),
    ).rejects.toMatchObject({ status: 500, message: 'nope' });
  });

  it('POST login serializes body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        token: 't',
        user: { id: '1', username: 'admin', roles: ['admin'], locale: 'en' },
      }),
    );
    await api.login('admin', 'secret', '123456');
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      username: 'admin',
      password: 'secret',
      totp: '123456',
    });
  });

  it('covers remaining auth/security helpers and downloadAuthenticated', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.logout();
    await api.setLocale('zh-CN');
    await api.totpStatus();
    await api.totpBegin({ password: 'x' });
    await api.totpConfirm('123456');
    await api.totpStepUp('123456');
    await api.totpDisable('123456');
    await api.listSessions();
    await api.revokeSession('s1');
    await api.revokeOtherSessions();
    await api.getSecuritySettings();
    await api.setSecuritySettings({ requireAdminTotp: true });
    await api.listApiKeys();
    await api.createApiKey('ci');
    await api.deleteApiKey('k1');

    // downloadAuthenticated success
    const blob = new Blob(['data']);
    fetchMock.mockResolvedValueOnce(
      new Response(blob, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }),
    );
    const createObj = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    authStore.setToken('tok');
    await api.downloadAuthenticated('/api/v1/files/dl', 'a.bin');
    createObj.mockRestore();
    revoke.mockRestore();

    // downloadAuthenticated error
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 404));
    await expect(api.downloadAuthenticated('/api/v1/files/missing', 'x')).rejects.toMatchObject({
      status: 404,
    });

    // empty notes / results fallbacks for 422
    fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }, 422));
    await expect(api.requestRaw('/api/v1/x')).rejects.toMatchObject({ status: 422 });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ results: [{ notes: ['from-row'] }] }, 400),
    );
    await expect(api.requestRaw('/api/v1/batch2')).rejects.toMatchObject({
      message: 'from-row',
    });

    // generic status fallback
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 418));
    await expect(api.requestRaw('/api/v1/teapot')).rejects.toMatchObject({ status: 418 });
  });
});
