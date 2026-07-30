/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleDbRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'POST' && url.pathname === '/api/v1/db/adminer/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          download?: boolean;
          applySystem?: boolean;
        };
        const { applyAdminer } = await import('@ysk/core');
        const r = await applyAdminer({
          dataDir: ctx.dataDir,
          host: ctx.host,
          domain: data.domain,
          download: data.download !== false,
          applySystem: data.applySystem === true,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'db.adminer.apply',
          detail: r,
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/db/temp-users/expire') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { dropSystem?: boolean };
        const { expireTempDbUsers } = await import('@ysk/core');
        const r = await expireTempDbUsers({
          db: ctx.db,
          host: ctx.host,
          dropSystem: data.dropSystem !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'db.temp_user.expire',
          detail: r,
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/db/temp-users') {
        ctx.auth.authenticate(getBearer(req));
        const { listTempDbUsers } = await import('@ysk/core');
        sendJson(res, 200, { items: listTempDbUsers(ctx.db) });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/db/temp-users') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          engine?: 'mysql' | 'mariadb' | 'postgres';
          database?: string;
          username?: string;
          ttlHours?: number;
          apply?: boolean;
        };
        const { createTempReadonlyUser } = await import('@ysk/core');
        const r = await createTempReadonlyUser({
          db: ctx.db,
          host: ctx.host,
          engine: data.engine ?? 'mysql',
          database: data.database ?? '',
          username: data.username,
          ttlHours: data.ttlHours,
          actor: user.username,
          apply: data.apply !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'db.temp_user.create',
          resource: data.database,
          detail: { ok: r.ok, username: r.user?.username, status: r.user?.apply_status },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/db/remote-hosts') {
        ctx.auth.authenticate(getBearer(req));
        const { listRemoteDbHosts } = await import('@ysk/core');
        sendJson(res, 200, { items: listRemoteDbHosts(ctx.db) });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/db/remote-hosts') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          id?: string;
          engine?: 'mysql' | 'mariadb' | 'postgres';
          label?: string;
          host?: string;
          port?: number;
          username?: string;
          password?: string;
        };
        const { upsertRemoteDbHost } = await import('@ysk/core');
        const row = upsertRemoteDbHost(ctx.db, {
          id: data.id,
          engine: data.engine ?? 'mysql',
          label: data.label ?? data.host ?? '',
          host: data.host ?? '',
          port: data.port,
          username: data.username,
          password: data.password,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'db.remote_host.upsert',
          resource: row.id,
          detail: { host: row.host, engine: row.engine },
          ok: true,
        });
        sendJson(res, 200, { host: row });
        return true;
      }
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
  return false;
}
