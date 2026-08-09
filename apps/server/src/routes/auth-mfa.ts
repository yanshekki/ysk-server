/**
 * Auth MFA — TOTP, WebAuthn, devices, backup codes.
 * Extracted from auth.ts (Wave L3). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { YskError } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleAuthMfaRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'POST' && url.pathname === '/api/v1/auth/totp/step-up') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { code?: string };
        const r = ctx.auth.verifyStepUp(user.id, data.code ?? '');
        sendJson(res, 200, r);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/auth/totp') {
        const user = ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, ctx.auth.totpStatus(user.id));
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/totp/begin') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req).catch(() => '{}');
        const data = JSON.parse(raw || '{}') as { password?: string; totp?: string };
        try {
          sendJson(
            res,
            200,
            ctx.auth.beginTotp(user.id, {
              password: data.password,
              totp: data.totp,
            }),
          );
          return true;
        } catch (e) {
          if (e instanceof YskError) {
            sendJson(res, e.httpStatus || 403, {
              ok: false,
              code: e.code,
              message: e.message,
              needsReauth: true,
            });
            return true;
          }
          throw e;
        }
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/totp/confirm') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { code?: string };
        sendJson(res, 200, ctx.auth.confirmTotp(user.id, data.code ?? ''));
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/totp/disable') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { code?: string };
        sendJson(res, 200, ctx.auth.disableTotp(user.id, data.code ?? ''));
        return true;
      }
      // —— WebAuthn passkeys ——
      if (method === 'GET' && url.pathname === '/api/v1/auth/webauthn/credentials') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { listWebAuthnCredentials } = await import('@ysk/core');
        sendJson(res, 200, {
          ok: true,
          items: listWebAuthnCredentials(ctx.db, user.id),
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/webauthn/register/begin') {
        const user = ctx.auth.authenticate(getBearer(req));
        const origin = String(req.headers.origin ?? '');
        const { beginWebAuthnRegistration } = await import('@ysk/core');
        const options = await beginWebAuthnRegistration({
          db: ctx.db,
          userId: user.id,
          username: user.username,
          origin,
        });
        sendJson(res, 200, { ok: true, options });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/webauthn/register/finish') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          response?: unknown;
          name?: string;
        };
        const { finishWebAuthnRegistration } = await import('@ysk/core');
        const r = await finishWebAuthnRegistration({
          db: ctx.db,
          userId: user.id,
          response: data.response as never,
          origin: String(req.headers.origin ?? ''),
          name: data.name,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'auth.webauthn.register',
          detail: { ok: r.ok },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/webauthn/authenticate/begin') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { beginWebAuthnAuthentication } = await import('@ysk/core');
        const r = await beginWebAuthnAuthentication({
          db: ctx.db,
          userId: user.id,
          origin: String(req.headers.origin ?? ''),
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/webauthn/authenticate/finish') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { response?: unknown };
        const { finishWebAuthnAuthentication, markTotpStepUp } = await import('@ysk/core');
        const r = await finishWebAuthnAuthentication({
          db: ctx.db,
          userId: user.id,
          response: data.response as never,
          origin: String(req.headers.origin ?? ''),
        });
        if (r.ok) markTotpStepUp(user.id);
        ctx.audit.append({
          actor: user.username,
          action: 'auth.webauthn.authenticate',
          detail: { ok: r.ok },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      // —— Remember device ——
      if (method === 'GET' && url.pathname === '/api/v1/auth/devices') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { listRememberDevices } = await import('@ysk/core');
        sendJson(res, 200, {
          ok: true,
          items: listRememberDevices(ctx.db, user.id),
        });
        return true;
      }
      if (method === 'DELETE' && url.pathname === '/api/v1/auth/devices') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { revokeAllRememberDevices } = await import('@ysk/core');
        const n = revokeAllRememberDevices(ctx.db, user.id);
        sendJson(res, 200, { ok: true, revoked: n });
        return true;
      }
      // —— 2FA backup + fail2ban snippets ——
      if (method === 'POST' && url.pathname === '/api/v1/auth/totp/backup') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req).catch(() => '{}');
        const data = JSON.parse(raw || '{}') as { totp?: string };
        try {
          ctx.auth.requireStepUp(user.id, data.totp);
        } catch (e) {
          if (e instanceof YskError) {
            sendJson(res, e.httpStatus || 403, {
              ok: false,
              code: e.code,
              message: e.message,
              needsStepUp: true,
            });
            return true;
          }
          throw e;
        }
        const row = ctx.db.snapshot.users.find((u) => u.id === user.id);
        if (!row) {
          sendJson(res, 404, { ok: false });
          return true;
        }
        const { exportTotpBackup } = await import('@ysk/core');
        const r = exportTotpBackup({ dataDir: ctx.dataDir, user: row });
        ctx.audit.append({
          actor: user.username,
          action: 'auth.totp.backup_export',
          detail: { ok: r.ok },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      // WebAuthn credential delete (moved from misc)
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/auth\/webauthn\/credentials\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[6] ?? '';
        const { deleteWebAuthnCredential } = await import('@ysk/core');
        const ok = deleteWebAuthnCredential(ctx.db, user.id, id);
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }
      // Remember-device revoke (moved from misc)
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/auth\/devices\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5] ?? '';
        const { revokeRememberDevice } = await import('@ysk/core');
        const ok = revokeRememberDevice(ctx.db, user.id, id);
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }

  return false;
}
