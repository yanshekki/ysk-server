/**
 * HTTP routes — users & packages (capability-gated) + usage honesty enrich.
 * List endpoints support unified ListQuery (q + dimension filters + meta).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostPackageUsage, userPackageUsage } from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import { getBearer, readBody, sendJson } from '../http/util.js';
import { requireCap } from '../http/rbac-guard.js';

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
  return false;
}
