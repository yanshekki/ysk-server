import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

const ADMIN_PASSWORD = 'TestPass-Strong-99!';

describe('auth routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects bad credentials and serves me with token', async () => {
    ts = await startTestServer();
    const bad = await apiJson(
      ts,
      'POST',
      '/api/v1/auth/login',
      {
        username: 'admin',
        password: 'wrong-password-xyz',
      },
      { auth: false },
    );
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect((bad.body as { ok?: boolean }).ok).not.toBe(true);

    const me = await apiJson(ts, 'GET', '/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect((me.body as { user?: { username?: string } }).user?.username).toBe('admin');
  });

  it('rejects unauthenticated me', async () => {
    ts = await startTestServer();
    const me = await apiJson(ts, 'GET', '/api/v1/auth/me', undefined, { auth: false });
    expect(me.status).toBeGreaterThanOrEqual(401);
  });

  it('lists sessions and can logout', async () => {
    ts = await startTestServer();
    const sessions = await apiJson(ts, 'GET', '/api/v1/auth/sessions');
    expect(sessions.status).toBe(200);
    const logout = await apiJson(ts, 'POST', '/api/v1/auth/logout', {});
    expect(logout.status).toBeLessThan(500);
  });

  it('totp status endpoint is reachable when authed', async () => {
    ts = await startTestServer();
    const totp = await apiJson(ts, 'GET', '/api/v1/auth/totp');
    expect(totp.status).toBe(200);
    // honesty: must not claim enabled without enrollment
    const body = totp.body as { enabled?: boolean; totpEnabled?: boolean };
    expect(body.enabled === true || body.totpEnabled === true).toBe(false);
  });

  it('totp begin with password returns secret (dry enroll, not enabled)', async () => {
    ts = await startTestServer({ adminPassword: ADMIN_PASSWORD });
    const begin = await apiJson(ts, 'POST', '/api/v1/auth/totp/begin', {
      password: ADMIN_PASSWORD,
    });
    expect(begin.status).toBe(200);
    const body = begin.body as {
      secret?: string;
      otpauthUrl?: string;
      enabled?: boolean;
    };
    expect(typeof body.secret).toBe('string');
    expect(body.secret!.length).toBeGreaterThan(8);
    expect(body.otpauthUrl).toMatch(/^otpauth:\/\//);
    // honesty: begin alone must not claim fully enabled 2FA
    expect(body.enabled).toBe(false);

    const status = await apiJson(ts, 'GET', '/api/v1/auth/totp');
    expect(status.status).toBe(200);
    const st = status.body as { enabled?: boolean; totpEnabled?: boolean };
    expect(st.enabled === true || st.totpEnabled === true).toBe(false);
  });

  it('totp begin without reauth is rejected honestly', async () => {
    ts = await startTestServer();
    const begin = await apiJson(ts, 'POST', '/api/v1/auth/totp/begin', {});
    expect(begin.status).toBeGreaterThanOrEqual(400);
    const body = begin.body as { ok?: boolean; needsReauth?: boolean };
    expect(body.ok).not.toBe(true);
    expect(body.needsReauth === true || begin.status === 403).toBe(true);
  });

  it('PATCH locale and list api-keys', async () => {
    ts = await startTestServer();
    const locale = await apiJson(ts, 'PATCH', '/api/v1/auth/locale', { locale: 'en' });
    expect(locale.status).toBe(200);
    expect((locale.body as { ok?: boolean }).ok).toBe(true);

    const keys = await apiJson(ts, 'GET', '/api/v1/auth/api-keys');
    expect(keys.status).toBe(200);
    expect(Array.isArray((keys.body as { items?: unknown[] }).items)).toBe(true);
  });

  it('DELETE other sessions is honest', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'DELETE', '/api/v1/auth/sessions');
    expect(res.status).toBe(200);
    const body = res.body as { ok?: boolean; revoked?: number };
    expect(body.ok).toBe(true);
    expect(typeof body.revoked).toBe('number');
  });

  it('step-up without totp enrolled fails honestly', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/auth/totp/step-up', { code: '000000' });
    expect(res.status).toBeLessThan(500);
    // Either error or not-ok — must not claim step-up success without TOTP
    if (res.status < 400) {
      expect((res.body as { ok?: boolean }).ok).not.toBe(true);
    }
  });
});
