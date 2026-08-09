/**
 * Admin users create/patch/delete/impersonate/security (Wave AA2).
 * Extracted from admin-users.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { YskError } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { requireUserCap } from '../http/handler.js';
import { requireCap } from '../http/rbac-guard.js';
import { getBearer, readBody, sendJson } from '../http/util.js';
import { optionalBoolean, optionalString, readJsonBody } from '../http/validate.js';

export async function handleAdminUsersOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/users') {
    const user = ctx.auth.authenticate(getBearer(req));
    requireCap(ctx, user, 'users.manage');
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      username?: string;
      password?: string;
      roles?: Array<'admin' | 'operator' | 'viewer' | 'agent'>;
      packageId?: string;
      locale?: string;
    };
    const created = ctx.usersAdmin.createUser({
      username: data.username ?? '',
      password: data.password ?? '',
      roles: data.roles,
      packageId: data.packageId,
      locale: data.locale,
      actor: user.username,
    });
    sendJson(res, 201, { user: created });
    return true;
  }
  // —— User / package mutations (moved from misc for domain ownership) ——
  if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/users\/[^/]+$/)) {
    const user = requireUserCap(ctx, req, 'users.manage');
    const id = url.pathname.split('/')[4]!;
    const data = await readJsonBody(req);
    const updated = ctx.usersAdmin.updateUser(
      id,
      {
        roles: data.roles as Array<'admin' | 'operator' | 'viewer' | 'agent'> | undefined,
        packageId:
          'packageId' in data ? (data.packageId as string | null | undefined) : undefined,
        suspended: optionalBoolean(data, 'suspended'),
        password: optionalString(data, 'password'),
      },
      user.username,
    );
    if (data.capabilityGrants !== undefined || data.capabilityRevokes !== undefined) {
      const row = ctx.db.snapshot.users.find((u) => u.id === user.id);
      ctx.rbac.setUserOverrides(
        id,
        {
          grants: data.capabilityGrants as string[] | null | undefined,
          revokes: data.capabilityRevokes as string[] | null | undefined,
        },
        {
          id: user.id,
          username: user.username,
          roles: user.roles,
          capability_grants: row?.capability_grants,
          capability_revokes: row?.capability_revokes,
        },
      );
    }
    const full = ctx.db.snapshot.users.find((u) => u.id === id);
    sendJson(res, 200, {
      user: {
        ...updated,
        capabilityGrants: full?.capability_grants,
        capabilityRevokes: full?.capability_revokes,
        capabilities: full ? ctx.rbac.effectiveForUser(full) : undefined,
      },
    });
    return true;
  }
  if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/users\/[^/]+$/)) {
    const user = requireUserCap(ctx, req, 'users.manage');
    const data = await readJsonBody(req).catch(() => ({}));
    try {
      ctx.auth.requireStepUp(user.id, (data as { totp?: string }).totp);
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
    const id = url.pathname.split('/')[4]!;
    const ok = ctx.usersAdmin.deleteUser(id, user.username);
    sendJson(res, ok ? 200 : 404, { ok });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/users\/[^/]+\/impersonate$/)) {
    const user = requireUserCap(ctx, req, 'users.impersonate');
    const id = url.pathname.split('/')[4]!;
    const result = ctx.usersAdmin.impersonate(id, {
      id: user.id,
      username: user.username,
      roles: user.roles,
    });
    sendJson(res, 200, result);
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/users\/[^/]+\/security$/)) {
    const _user = requireUserCap(ctx, req, 'users.manage');
    void _user;
    const id = url.pathname.split('/')[4]!;
    sendJson(res, 200, ctx.auth.userSecuritySummary(id));
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/users\/[^/]+\/security\/totp\/clear$/)) {
    const user = requireUserCap(ctx, req, 'users.manage');
    const id = url.pathname.split('/')[4]!;
    const data = await readJsonBody(req).catch(() => ({}));
    try {
      ctx.auth.requireStepUp(user.id, (data as { totp?: string }).totp);
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
    const target = ctx.db.snapshot.users.find((u) => u.id === id);
    if (!target) {
      sendJson(res, 404, { ok: false, code: 'YSK_NOT_FOUND', message: 'user not found' });
      return true;
    }
    const confirm = (data as { confirmUsername?: string }).confirmUsername;
    if (confirm && confirm.trim().toLowerCase() !== target.username.toLowerCase()) {
      sendJson(res, 400, {
        ok: false,
        code: 'YSK_VALIDATION',
        message: 'confirmUsername must match target username',
      });
      return true;
    }
    const result = ctx.auth.adminClearUserTotp(user.id, id);
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  return false;
}
