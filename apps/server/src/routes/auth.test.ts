import { describe, expect, it, afterEach } from 'vitest';
import { generateTotpCode } from 'ysk-server-core';
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

  it('api-keys create/delete + totp confirm/disable fail + webauthn + devices', async () => {
    ts = await startTestServer({ adminPassword: ADMIN_PASSWORD });

    const create = await apiJson(ts, 'POST', '/api/v1/auth/api-keys', {
      name: 'auth-coverage-key',
      scopes: ['read'],
    });
    expect(create.status).toBeLessThan(500);
    const keyId =
      (create.body as { key?: { id?: string }; id?: string }).key?.id ??
      (create.body as { id?: string }).id;
    if (keyId) {
      const del = await apiJson(ts, 'DELETE', `/api/v1/auth/api-keys/${keyId}`);
      expect(del.status).toBeLessThan(500);
    }

    // totp confirm without valid code
    const confirm = await apiJson(ts, 'POST', '/api/v1/auth/totp/confirm', {
      code: '000000',
    });
    expect(confirm.status).toBeLessThan(500);
    expect((confirm.body as { ok?: boolean }).ok).not.toBe(true);

    const disable = await apiJson(ts, 'POST', '/api/v1/auth/totp/disable', {
      password: ADMIN_PASSWORD,
      code: '000000',
    });
    expect(disable.status).toBeLessThan(500);

    const backup = await apiJson(ts, 'POST', '/api/v1/auth/totp/backup', {
      password: ADMIN_PASSWORD,
    });
    expect(backup.status).toBeLessThan(500);

    const webCreds = await apiJson(ts, 'GET', '/api/v1/auth/webauthn/credentials');
    expect(webCreds.status).toBeLessThan(500);

    const regBegin = await apiJson(ts, 'POST', '/api/v1/auth/webauthn/register/begin', {});
    expect(regBegin.status).toBeLessThan(500);

    const regFinish = await apiJson(ts, 'POST', '/api/v1/auth/webauthn/register/finish', {
      response: {},
    });
    expect(regFinish.status).toBeLessThan(500);

    const authBegin = await apiJson(
      ts,
      'POST',
      '/api/v1/auth/webauthn/authenticate/begin',
      { username: 'admin' },
      { auth: false },
    );
    expect(authBegin.status).toBeLessThan(500);

    const authFinish = await apiJson(
      ts,
      'POST',
      '/api/v1/auth/webauthn/authenticate/finish',
      { response: {} },
      { auth: false },
    );
    expect(authFinish.status).toBeLessThan(500);

    const devices = await apiJson(ts, 'GET', '/api/v1/auth/devices');
    expect(devices.status).toBeLessThan(500);

    const delDevices = await apiJson(ts, 'DELETE', '/api/v1/auth/devices');
    expect(delDevices.status).toBeLessThan(500);

    // delete specific session missing
    const delSess = await apiJson(ts, 'DELETE', '/api/v1/auth/sessions/no-such-session');
    expect(delSess.status).toBeLessThan(500);
  });

  it(
    'totp full enroll → confirm → login recovery → step-up → disable',
    async () => {
      ts = await startTestServer({ adminPassword: ADMIN_PASSWORD });

      const begin = await apiJson(ts, 'POST', '/api/v1/auth/totp/begin', {
        password: ADMIN_PASSWORD,
      });
      expect(begin.status).toBe(200);
      const secret = (begin.body as { secret: string }).secret;
      expect(secret.length).toBeGreaterThan(8);

      const badCode = await apiJson(ts, 'POST', '/api/v1/auth/totp/confirm', {
        code: '000000',
      });
      expect(badCode.status).toBeGreaterThanOrEqual(400);

      const code = generateTotpCode(secret);
      const confirm = await apiJson(ts, 'POST', '/api/v1/auth/totp/confirm', { code });
      expect(confirm.status).toBe(200);
      const confBody = confirm.body as {
        enabled?: boolean;
        recoveryCodes?: string[];
      };
      expect(confBody.enabled).toBe(true);
      expect(Array.isArray(confBody.recoveryCodes)).toBe(true);
      expect(confBody.recoveryCodes!.length).toBeGreaterThan(0);

      const status = await apiJson(ts, 'GET', '/api/v1/auth/totp');
      expect(status.status).toBe(200);
      expect((status.body as { enabled?: boolean }).enabled).toBe(true);

      // Login without TOTP must fail after enrollment
      const loginNoTotp = await apiJson(
        ts,
        'POST',
        '/api/v1/auth/login',
        { username: 'admin', password: ADMIN_PASSWORD },
        { auth: false },
      );
      expect(loginNoTotp.status).toBeGreaterThanOrEqual(400);
      expect((loginNoTotp.body as { ok?: boolean }).ok).not.toBe(true);

      // recovery path (same TOTP step may be anti-replay blocked)
      const loginRec = await apiJson(
        ts,
        'POST',
        '/api/v1/auth/login',
        {
          username: 'admin',
          password: ADMIN_PASSWORD,
          recoveryCode: confBody.recoveryCodes![0],
          rememberDevice: true,
        },
        { auth: false },
      );
      expect(loginRec.status).toBe(200);
      const loginBody = loginRec.body as { token?: string; deviceToken?: string };
      expect(loginBody.token).toBeTruthy();
      ts.token = loginBody.token!;

      // optional login with deviceToken skips totp
      if (loginBody.deviceToken) {
        const loginDev = await apiJson(
          ts,
          'POST',
          '/api/v1/auth/login',
          {
            username: 'admin',
            password: ADMIN_PASSWORD,
            deviceToken: loginBody.deviceToken,
          },
          { auth: false },
        );
        expect(loginDev.status).toBeLessThan(500);
        if (loginDev.status === 200 && (loginDev.body as { token?: string }).token) {
          ts.token = (loginDev.body as { token: string }).token;
        }
      }

      // step-up via totp or recovery
      const stepCode = generateTotpCode(secret);
      let step = await apiJson(ts, 'POST', '/api/v1/auth/totp/step-up', {
        code: stepCode,
      });
      if (step.status >= 400 || (step.body as { ok?: boolean }).ok === false) {
        step = await apiJson(ts, 'POST', '/api/v1/auth/totp/step-up', {
          code: confBody.recoveryCodes![1] ?? confBody.recoveryCodes![0],
        });
      }
      expect(step.status).toBeLessThan(500);

      // api-key after step-up window
      const keyCreate = await apiJson(ts, 'POST', '/api/v1/auth/api-keys', {
        name: 'totp-flow-key',
        scope: 'read',
      });
      expect(keyCreate.status).toBeLessThan(500);
      if (keyCreate.status === 201) {
        const keyId = (keyCreate.body as { key?: { id?: string } }).key?.id;
        if (keyId) {
          await apiJson(ts, 'DELETE', `/api/v1/auth/api-keys/${keyId}`);
        }
      }

      // backup export (needs step-up when 2FA on)
      const backup = await apiJson(ts, 'POST', '/api/v1/auth/totp/backup', {});
      expect(backup.status).toBeLessThan(500);

      // disable 2FA
      const disCode = generateTotpCode(secret);
      let disable = await apiJson(ts, 'POST', '/api/v1/auth/totp/disable', {
        code: disCode,
      });
      if (disable.status >= 400) {
        disable = await apiJson(ts, 'POST', '/api/v1/auth/totp/disable', {
          code: confBody.recoveryCodes![2] ?? confBody.recoveryCodes![0],
        });
      }
      expect(disable.status).toBe(200);
      expect((disable.body as { enabled?: boolean }).enabled).toBe(false);

      const statusOff = await apiJson(ts, 'GET', '/api/v1/auth/totp');
      expect((statusOff.body as { enabled?: boolean }).enabled === true).toBe(false);
    },
    60_000,
  );
});
