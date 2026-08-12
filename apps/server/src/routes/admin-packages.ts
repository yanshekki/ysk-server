/**
 * Admin packages CRUD (Wave L2).
 * Extracted from admin.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostPackageUsage, userPackageUsage } from '@ysk-server/core';
import type { AppContext } from '../app-context.js';
import { requireUserCap } from '../http/handler.js';
import { listWithQuery } from '../http/list-response.js';
import { requireCap } from '../http/rbac-guard.js';
import { getBearer, readBody, sendJson } from '../http/util.js';
import { readJsonBody } from '../http/validate.js';

export async function handleAdminPackagesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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
