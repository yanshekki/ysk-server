import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('auth routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects bad credentials and serves me with token', async () => {
    ts = await startTestServer();
    const bad = await apiJson(ts, 'POST', '/api/v1/auth/login', {
      username: 'admin',
      password: 'wrong-password-xyz',
    }, { auth: false });
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
});
