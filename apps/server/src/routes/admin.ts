/**
 * HTTP routes — users & packages (capability-gated) + usage honesty enrich.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostPackageUsage } from '@ysk/core';
import type { AppContext } from '../app-context.js';
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
    const items = ctx.usersAdmin.listUsers().map((u) => {
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
    sendJson(res, 200, { items });
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
    const items = ctx.usersAdmin.listPackages().map((p) => ({
      ...p,
      subscriberCount: users.filter((u) => u.packageId === p.id).length,
      /** Honest host-wide totals (not per-package isolation) */
      hostUsage,
      usageScope: 'host' as const,
    }));
    sendJson(res, 200, {
      items,
      hostUsage,
      usageNote: 'host_totals',
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
