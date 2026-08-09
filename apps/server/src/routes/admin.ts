/**
 * HTTP routes — users & packages (capability-gated) + usage honesty enrich.
 * List endpoints support unified ListQuery (q + dimension filters + meta).
 * Mutating user/package paths live here (not misc) for secondary-dev discoverability.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostPackageUsage, userPackageUsage } from '@ysk/core';
import { YskError } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { requireUserCap } from '../http/handler.js';
import { listWithQuery } from '../http/list-response.js';
import { requireCap } from '../http/rbac-guard.js';
import { getBearer, readBody, sendJson } from '../http/util.js';
import { optionalBoolean, optionalString, readJsonBody } from '../http/validate.js';

function lastSeenForUser(ctx: AppContext, userId: string): string | undefined {
  const sessions = (ctx.db.snapshot.sessions ?? []).filter((s) => s.user_id === userId);
  if (!sessions.length) return undefined;
  let best = '';
  for (const s of sessions) {
    const t = s.last_seen_at || s.created_at || '';
    if (t > best) best = t;
  }
  return best || undefined;
}

type UserListRow = {
  id: string;
  username: string;
  roles: string[];
  packageId?: string;
  packageName?: string;
  suspended?: boolean;
  totpEnabled?: boolean;
  capabilityGrants?: string[];
  capabilityRevokes?: string[];
  capabilities?: string[];
  lastSeenAt?: string;
};

export async function handleAdminRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— Users & packages ——
  if (method === 'GET' && url.pathname === '/api/v1/users') {
    const user = ctx.auth.authenticate(getBearer(req));
    requireCap(ctx, user, 'users.manage');
    const packages = ctx.usersAdmin.listPackages();
    const all: UserListRow[] = ctx.usersAdmin.listUsers().map((u) => {
      const row = ctx.db.snapshot.users.find((x) => x.id === u.id);
      return {
        ...u,
        capabilityGrants: row?.capability_grants,
        capabilityRevokes: row?.capability_revokes,
        capabilities: row ? ctx.rbac.effectiveForUser(row) : undefined,
        packageName: u.packageId
          ? packages.find((p) => p.id === u.packageId)?.name
          : undefined,
        lastSeenAt: lastSeenForUser(ctx, u.id),
      };
    });

    const { items, meta } = listWithQuery(
      url,
      all,
      {
        text: (u) => [u.username, u.packageName, u.roles.join(' '), u.id],
        predicates: {
          role: (u, v) => u.roles.includes(v),
          status: (u, v) => (v === 'suspended' ? Boolean(u.suspended) : !u.suspended),
          totp: (u, v) => (v === '1' ? Boolean(u.totpEnabled) : !u.totpEnabled),
          overrides: (u, v) => {
            if (v !== '1') return true;
            return (
              (u.capabilityGrants?.length ?? 0) > 0 || (u.capabilityRevokes?.length ?? 0) > 0
            );
          },
          package: (u, v) => {
            if (v === 'none') return !u.packageId;
            return u.packageId === v;
          },
        },
        facetOf: {
          role: (u) => u.roles[0] ?? 'viewer',
          status: (u) => (u.suspended ? 'suspended' : 'active'),
          totp: (u) => (u.totpEnabled ? '1' : '0'),
          overrides: (u) =>
            (u.capabilityGrants?.length ?? 0) > 0 || (u.capabilityRevokes?.length ?? 0) > 0
              ? '1'
              : '0',
          package: (u) => (u.packageId ? u.packageId : 'none'),
        },
        sortOf: {
          username: (a, b) => a.username.localeCompare(b.username),
          lastSeenAt: (a, b) => (a.lastSeenAt ?? '').localeCompare(b.lastSeenAt ?? ''),
        },
      },
      {
        enums: {
          role: ['admin', 'operator', 'viewer', 'agent'],
          status: ['active', 'suspended'],
          totp: ['0', '1'],
          overrides: ['1'],
          package: ['none'],
        },
        freeFilters: ['package'],
        sortFields: ['username', 'lastSeenAt'],
      },
    );

    sendJson(res, 200, { items, meta });
    return true;
  }
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
  if (method === 'GET' && url.pathname === '/api/v1/packages') {
    const user = ctx.auth.authenticate(getBearer(req));
    const row = ctx.db.snapshot.users.find((u) => u.id === user.id);
    const canList =
      ctx.rbac.actorCan(
        {
          roles: user.roles,
          capability_grants: row?.capability_grants,
          capability_revokes: row?.capability_revokes,
        },
        'packages.manage',
      ) ||
      ctx.rbac.actorCan(
        {
          roles: user.roles,
          capability_grants: row?.capability_grants,
          capability_revokes: row?.capability_revokes,
        },
        'users.manage',
      );
    if (!canList) {
      requireCap(ctx, user, 'packages.manage');
    }
    const users = ctx.usersAdmin.listUsers();
    const hostUsage = hostPackageUsage(ctx.db);
    const all = ctx.usersAdmin.listPackages().map((p) => ({
      ...p,
      subscriberCount: users.filter((u) => u.packageId === p.id).length,
      /** Honest host-wide totals (not per-package isolation) */
      hostUsage,
      usageScope: 'host' as const,
    }));

    const { items, meta } = listWithQuery(
      url,
      all,
      {
        text: (p) => [p.name, p.notes, p.id],
        sortOf: {
          name: (a, b) => a.name.localeCompare(b.name),
          subscriberCount: (a, b) => (a.subscriberCount ?? 0) - (b.subscriberCount ?? 0),
        },
      },
      { sortFields: ['name', 'subscriberCount'] },
    );

    // Per-user usage for the caller (package quota scope)
    let userUsage = null as ReturnType<typeof userPackageUsage> | null;
    try {
      userUsage = userPackageUsage(ctx.db, user.id);
    } catch {
      userUsage = null;
    }
    sendJson(res, 200, {
      items,
      meta,
      hostUsage,
      userUsage,
      usageNote: 'user_owned_counts_for_quota; hostUsage_is_ops_honesty',
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/packages') {
    const user = ctx.auth.authenticate(getBearer(req));
    requireCap(ctx, user, 'packages.manage');
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      name?: string;
      maxProjects?: number;
      maxMailboxes?: number;
      maxDatabases?: number;
      diskMb?: number;
      bandwidthMb?: number;
      allowSsh?: boolean;
      allowFtp?: boolean;
      notes?: string;
    };
    const pkg = ctx.usersAdmin.createPackage(
      {
        name: data.name ?? '',
        maxProjects: data.maxProjects,
        maxMailboxes: data.maxMailboxes,
        maxDatabases: data.maxDatabases,
        diskMb: data.diskMb,
        bandwidthMb: data.bandwidthMb,
        allowSsh: data.allowSsh,
        allowFtp: data.allowFtp,
        notes: data.notes,
      },
      user.username,
    );
    sendJson(res, 201, { package: pkg });
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
  if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/packages\/[^/]+$/)) {
    const user = requireUserCap(ctx, req, 'packages.manage');
    const id = url.pathname.split('/')[4]!;
    const data = await readJsonBody(req);
    const pkg = ctx.usersAdmin.updatePackage(
      id,
      {
        name: data.name as string | undefined,
        max_projects: data.max_projects as number | undefined,
        max_mailboxes: data.max_mailboxes as number | undefined,
        max_databases: data.max_databases as number | undefined,
        disk_mb: data.disk_mb as number | undefined,
        bandwidth_mb: data.bandwidth_mb as number | undefined,
        allow_ssh: data.allow_ssh as boolean | undefined,
        allow_ftp: data.allow_ftp as boolean | undefined,
        notes: data.notes as string | undefined,
      },
      user.username,
    );
    sendJson(res, 200, { package: pkg });
    return true;
  }
  if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/packages\/[^/]+$/)) {
    const user = requireUserCap(ctx, req, 'packages.manage');
    const id = url.pathname.split('/')[4]!;
    const ok = ctx.usersAdmin.deletePackage(id, user.username);
    sendJson(res, ok ? 200 : 404, { ok });
    return true;
  }
  return false;
}
