/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  YskError,
} from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleAuthRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'POST' && url.pathname === '/api/v1/auth/login') {
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          username?: string;
          password?: string;
          totp?: string;
          recoveryCode?: string;
          deviceToken?: string;
          rememberDevice?: boolean;
        };
        const ip =
          (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
          req.socket.remoteAddress ||
          'local';
        try {
          const result = ctx.auth.login(
            {
              username: data.username ?? '',
              password: data.password ?? '',
              totp: data.totp,
              recoveryCode: data.recoveryCode,
              deviceToken: data.deviceToken,
              rememberDevice: data.rememberDevice === true,
            },
            {
              ip,
              userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
            },
          );
          sendJson(res, 200, result);
          return true;
        } catch (e) {
          if (e instanceof YskError) {
            const d = (e.details ?? {}) as {
              needsTotp?: boolean;
              locked?: boolean;
              retryAfterSec?: number;
            };
            if (d.needsTotp || d.locked || e.httpStatus === 429) {
              sendJson(res, e.httpStatus || 401, {
                ok: false,
                code: e.code,
                message: e.localize(),
                needsTotp: d.needsTotp,
                locked: d.locked,
                retryAfterSec: d.retryAfterSec,
                details: e.details,
              });
              return true;
            }
          }
          throw e;
        }
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/totp/step-up') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { code?: string };
        const r = ctx.auth.verifyStepUp(user.id, data.code ?? '');
        sendJson(res, 200, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/logout') {
        ctx.auth.logout(getBearer(req));
        sendJson(res, 200, { ok: true });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/auth/me') {
        const user = ctx.auth.authenticate(getBearer(req));
        const row = ctx.db.snapshot.users.find((u) => u.id === user.id);
        const capabilities = ctx.rbac.effectiveForUser({
          roles: user.roles,
          capability_grants: row?.capability_grants ?? user.capabilityGrants,
          capability_revokes: row?.capability_revokes ?? user.capabilityRevokes,
        });
        sendJson(res, 200, {
          user: {
            ...user,
            capabilities,
            capabilityGrants: row?.capability_grants,
            capabilityRevokes: row?.capability_revokes,
          },
          capabilities,
          requireAdminTotp: ctx.auth.isAdminTotpRequired(),
          mustEnrollTotp:
            ctx.auth.isAdminTotpRequired() &&
            user.roles.includes('admin') &&
            !user.totpEnabled,
        });
        return true;
      }
      if (method === 'PATCH' && url.pathname === '/api/v1/auth/locale') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { locale?: string };
        const updated = ctx.auth.setOwnLocale(user.id, data.locale ?? 'zh-HK');
        sendJson(res, 200, { ok: true, user: updated });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/auth/sessions') {
        const token = getBearer(req);
        const user = ctx.auth.authenticate(token);
        sendJson(res, 200, {
          ok: true,
          items: ctx.auth.listSessions(user.id, token),
          idleMs: 4 * 60 * 60 * 1000,
          absoluteMs: 24 * 60 * 60 * 1000,
        });
        return true;
      }
      if (method === 'DELETE' && url.pathname === '/api/v1/auth/sessions') {
        const token = getBearer(req);
        const user = ctx.auth.authenticate(token);
        const n = ctx.auth.revokeOtherSessions(user.id, token ?? '');
        sendJson(res, 200, { ok: true, revoked: n });
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
      if (method === 'GET' && url.pathname === '/api/v1/auth/api-keys') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { listApiKeys } = await import('@ysk/core');
        void user;
        sendJson(res, 200, { items: listApiKeys(ctx.db) });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/api-keys') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          totp?: string;
          scope?: 'full' | 'read';
        };
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
        const { createApiKey } = await import('@ysk/core');
        const created = createApiKey(ctx.db, {
          name: data.name ?? 'api-key',
          userId: user.id,
          scope: data.scope === 'read' ? 'read' : 'full',
        });
        ctx.audit.append({
          actor: user.username,
          action: 'auth.api_key.create',
          detail: {
            id: created.key.id,
            name: created.key.name,
            scope: created.key.scope,
          },
          ok: true,
        });
        sendJson(res, 201, created);
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
      // DELETE single session by id prefix (moved from misc)
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/auth\/sessions\/[^/]+$/)) {
        const token = getBearer(req);
        const user = ctx.auth.authenticate(token);
        const id = url.pathname.split('/')[5] ?? '';
        const ok = ctx.auth.revokeSession(user.id, id);
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }
      // DELETE API key by id (moved from misc)
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/auth\/api-keys\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5] ?? '';
        const { deleteApiKey } = await import('@ysk/core');
        const ok = deleteApiKey(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'auth.api_key.delete',
          resource: id,
          detail: { ok },
          ok,
        });
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }
  return false;
}
