/**
 * DB HA clusters list/create/get/patch/delete.
 * Extracted from db-clusters.ts (Wave Q1). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
} from '../http/util.js';

export async function handleDbClustersCrudRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      // —— DB HA clusters ——
      if (method === 'GET' && url.pathname === '/api/v1/db/clusters/overview') {
        ctx.auth.authenticate(getBearer(req));
        const { listDbClusters, firewallPortsForCluster } = await import('@ysk/core');
        const items = listDbClusters(ctx.db);
        sendJson(res, 200, {
          ok: true,
          count: items.length,
          items: items.map((c) => ({
            id: c.id,
            name: c.name,
            engine: c.engine,
            kind: c.kind,
            status: c.status,
            members: c.members.length,
            firewallPorts: firewallPortsForCluster(c.kind),
            updatedAt: c.updatedAt,
          })),
        });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/db/clusters') {
        ctx.auth.authenticate(getBearer(req));
        const { listDbClusters } = await import('@ysk/core');
        const engine = url.searchParams.get('engine') as
          | 'mysql'
          | 'mariadb'
          | 'postgres'
          | 'redis'
          | null;
        const items = listDbClusters(
          ctx.db,
          engine && ['mysql', 'mariadb', 'postgres', 'redis'].includes(engine)
            ? engine
            : undefined,
        );
        sendJson(res, 200, { ok: true, items });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/db/clusters') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          engine?: 'mysql' | 'mariadb' | 'postgres' | 'redis';
          kind?: string;
          members?: Array<{
            host: string;
            role?: string;
            port?: number;
            access?: 'local' | 'ssh' | 'fleet';
            label?: string;
            fleetAgentId?: string;
          }>;
          params?: Record<string, string | number | boolean>;
        };
        const { createDbCluster } = await import('@ysk/core');
        const cluster = createDbCluster(ctx.db, {
          name: data.name ?? '',
          engine: data.engine ?? 'mariadb',
          kind: (data.kind ?? 'mariadb-galera') as 'mariadb-galera',
          members: data.members,
          params: data.params,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'db.cluster.create',
          resource: cluster.id,
          detail: { name: cluster.name, kind: cluster.kind, members: cluster.members.length },
          ok: true,
        });
        sendJson(res, 201, { ok: true, cluster });
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { getDbCluster, firewallPortsForCluster } = await import('@ysk/core');
        const cluster = getDbCluster(ctx.db, id);
        sendJson(res, 200, {
          ok: true,
          cluster,
          firewallPorts: firewallPortsForCluster(cluster.kind) });
        return true;
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          params?: Record<string, string | number | boolean>;
          members?: Array<{
            id?: string;
            host: string;
            role?: string;
            port?: number;
            access?: 'local' | 'ssh' | 'fleet';
            label?: string;
            fleetAgentId?: string;
          }>;
          notes?: string[];
        };
        const { updateDbCluster, firewallPortsForCluster } = await import('@ysk/core');
        const cluster = updateDbCluster(ctx.db, id, {
          name: data.name,
          params: data.params,
          members: data.members as never,
          notes: data.notes });
        ctx.audit.append({
          actor: user.username,
          action: 'db.cluster.patch',
          resource: id,
          detail: { name: cluster.name, members: cluster.members.length },
          ok: true });
        sendJson(res, 200, {
          ok: true,
          cluster,
          firewallPorts: firewallPortsForCluster(cluster.kind) });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { deleteDbCluster } = await import('@ysk/core');
        const ok = deleteDbCluster(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'db.cluster.delete',
          resource: id,
          detail: { ok, note: 'registry only; conf on disk not auto-removed' },
          ok });
        sendJson(res, ok ? 200 : 404, {
          ok,
          notes: ok
            ? [tl('notes.auto.n0738')]
            : [tl('notes.auto.n0856')] });
        return true;
      }

  return false;
}
