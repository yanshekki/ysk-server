/**
 * Admin users list (Wave AA2).
 * Extracted from admin-users.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import { requireCap } from '../http/rbac-guard.js';
import { getBearer, sendJson } from '../http/util.js';

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

export async function handleAdminUsersListRoutes(
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

  return false;
}
