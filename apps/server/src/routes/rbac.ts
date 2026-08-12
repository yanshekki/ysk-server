import {
  CAPABILITY_CATALOG,
  SYSTEM_ROLES,
  YskError,
  type OperationLevel,
  type SystemRole,
} from '@yanshekki/shared';
/**
 * RBAC policy admin API — catalog, defaults, role policies, restore.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson } from '../http/util.js';
import { effectiveCaps, requireCap } from '../http/rbac-guard.js';

export async function handleRbacRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/rbac')) return false;

  try {
    // GET catalog — any authenticated user (for UI labels / previews)
    if (method === 'GET' && url.pathname === '/api/v1/rbac/catalog') {
      ctx.auth.authenticate(getBearer(req));
      sendJson(res, 200, {
        ok: true,
        items: CAPABILITY_CATALOG,
        roles: SYSTEM_ROLES,
      });
      return true;
    }

    // GET factory defaults
    if (method === 'GET' && url.pathname === '/api/v1/rbac/defaults') {
      const user = ctx.auth.authenticate(getBearer(req));
      requireCap(ctx, user, 'rbac.policy');
      sendJson(res, 200, { ok: true, ...ctx.rbac.defaults() });
      return true;
    }

    // GET current role policies
    if (method === 'GET' && url.pathname === '/api/v1/rbac/policies') {
      const user = ctx.auth.authenticate(getBearer(req));
      // users.manage can preview for user drawer; rbac.policy for edit
      const caps = effectiveCaps(ctx, user);
      if (!caps.includes('rbac.policy') && !caps.includes('users.manage')) {
        requireCap(ctx, user, 'rbac.policy');
      }
      sendJson(res, 200, { ok: true, items: ctx.rbac.listPolicies() });
      return true;
    }

    // PUT /api/v1/rbac/policies/:role
    const putMatch = url.pathname.match(/^\/api\/v1\/rbac\/policies\/([^/]+)$/);
    if (method === 'PUT' && putMatch) {
      const user = ctx.auth.authenticate(getBearer(req));
      const role = putMatch[1] as SystemRole;
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        maxLevel?: OperationLevel;
        capabilities?: string[];
      };
      const row = ctx.db.snapshot.users.find((u) => u.id === user.id);
      const view = ctx.rbac.setRolePolicy(role, data, {
        id: user.id,
        username: user.username,
        roles: user.roles,
        capability_grants: row?.capability_grants,
        capability_revokes: row?.capability_revokes,
      });
      sendJson(res, 200, { ok: true, item: view });
      return true;
    }

    // POST restore one role
    const restoreMatch = url.pathname.match(/^\/api\/v1\/rbac\/policies\/([^/]+)\/restore$/);
    if (method === 'POST' && restoreMatch) {
      const user = ctx.auth.authenticate(getBearer(req));
      const role = restoreMatch[1] as SystemRole;
      const row = ctx.db.snapshot.users.find((u) => u.id === user.id);
      const view = ctx.rbac.restoreRole(role, {
        id: user.id,
        username: user.username,
        roles: user.roles,
        capability_grants: row?.capability_grants,
        capability_revokes: row?.capability_revokes,
      });
      sendJson(res, 200, { ok: true, item: view });
      return true;
    }

    // POST restore all
    if (method === 'POST' && url.pathname === '/api/v1/rbac/policies/restore-all') {
      const user = ctx.auth.authenticate(getBearer(req));
      const row = ctx.db.snapshot.users.find((u) => u.id === user.id);
      const items = ctx.rbac.restoreAllRoles({
        id: user.id,
        username: user.username,
        roles: user.roles,
        capability_grants: row?.capability_grants,
        capability_revokes: row?.capability_revokes,
      });
      sendJson(res, 200, { ok: true, items });
      return true;
    }

    // POST restore user overrides
    const userRestore = url.pathname.match(/^\/api\/v1\/users\/([^/]+)\/capabilities\/restore$/);
    // handled under users path — also accept /api/v1/rbac/users/:id/restore
    const rbacUserRestore = url.pathname.match(/^\/api\/v1\/rbac\/users\/([^/]+)\/restore$/);
    if (method === 'POST' && (userRestore || rbacUserRestore)) {
      const user = ctx.auth.authenticate(getBearer(req));
      const id = (userRestore?.[1] ?? rbacUserRestore?.[1])!;
      const row = ctx.db.snapshot.users.find((u) => u.id === user.id);
      const updated = ctx.rbac.restoreUserOverrides(id, {
        id: user.id,
        username: user.username,
        roles: user.roles,
        capability_grants: row?.capability_grants,
        capability_revokes: row?.capability_revokes,
      });
      sendJson(res, 200, {
        ok: true,
        user: {
          id: updated.id,
          username: updated.username,
          roles: updated.roles,
          capabilityGrants: updated.capability_grants,
          capabilityRevokes: updated.capability_revokes,
          capabilities: ctx.rbac.effectiveForUser(updated),
        },
      });
      return true;
    }

    // PATCH user capability overrides via /api/v1/rbac/users/:id
    const patchUser = url.pathname.match(/^\/api\/v1\/rbac\/users\/([^/]+)$/);
    if (method === 'PATCH' && patchUser) {
      const user = ctx.auth.authenticate(getBearer(req));
      const id = patchUser[1]!;
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        capabilityGrants?: string[] | null;
        capabilityRevokes?: string[] | null;
      };
      const row = ctx.db.snapshot.users.find((u) => u.id === user.id);
      const updated = ctx.rbac.setUserOverrides(
        id,
        {
          grants: data.capabilityGrants,
          revokes: data.capabilityRevokes,
        },
        {
          id: user.id,
          username: user.username,
          roles: user.roles,
          capability_grants: row?.capability_grants,
          capability_revokes: row?.capability_revokes,
        },
      );
      sendJson(res, 200, {
        ok: true,
        user: {
          id: updated.id,
          username: updated.username,
          roles: updated.roles,
          capabilityGrants: updated.capability_grants,
          capabilityRevokes: updated.capability_revokes,
          capabilities: ctx.rbac.effectiveForUser(updated),
        },
      });
      return true;
    }

    return false;
  } catch (e) {
    if (e instanceof YskError) {
      sendJson(res, e.httpStatus || 500, {
        ok: false,
        code: e.code,
        message: e.message,
        details: e.details,
      });
      return true;
    }
    throw e;
  }
}
