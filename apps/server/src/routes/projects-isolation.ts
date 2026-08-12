/**
 * Project isolation report / backfill / provision-all (Wave T3).
 * Extracted from projects-crud.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
} from '../http/util.js';

export async function handleProjectsIsolationRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/projects/isolation') {
    ctx.auth.authenticate(getBearer(req));
    const { listIsolationReport } = await import('@ysk-server/core');
    const snaps = ctx.projects.list().map((p) => ({
      id: p.id,
      name: p.name,
      linuxUser: p.linuxUser,
      homeDir: p.homeDir,
      osProvisioned: Boolean(p.osProvisioned),
      ownerUserId: p.ownerUserId,
    }));
    sendJson(res, 200, listIsolationReport(snaps));
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/projects/isolation/backfill-owners') {
    const user = ctx.auth.authenticate(getBearer(req));
    const { requireCap } = await import('../http/rbac-guard.js');
    requireCap(ctx, user, 'users.manage');
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      ownerUserId?: string;
      projectIds?: string[];
    };
    const ownerUserId = data.ownerUserId ?? user.id;
    const { backfillProjectOwners } = await import('@ysk-server/core');
    const r = backfillProjectOwners(ctx.db, ownerUserId, {
      projectIds: data.projectIds,
      onlyUnowned: true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'projects.isolation.backfill_owners',
      detail: r,
      ok: true,
    });
    sendJson(res, 200, { ok: true, ...r });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/projects/isolation/provision-all') {
    const user = ctx.auth.authenticate(getBearer(req));
    const { requireCap } = await import('../http/rbac-guard.js');
    requireCap(ctx, user, 'projects.write');
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      limit?: number;
      projectIds?: string[];
    };
    const r = await ctx.projects.provisionOsIsolationAll(user.username, data);
    sendJson(res, r.ok || r.attempted > 0 ? 200 : 422, r);
    return true;
  }

  return false;
}
