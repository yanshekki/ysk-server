/**
 * Hosting infra services — nginx, firewall, files, DB provision.
 * Extracted from hosting-infra.ts (Wave O2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listManagedNginxConfs,
  listMergedNginxSites,
  readNginxSiteConf,
  applyManagedNginxSite,
  getResource,
  applyPublicFileServer,
  planFirewall,
  planPublicFileServer,
  probeEndpoint,
  renderMysqlProvisionSql,
  syncNginxConfigs,
  provisionMysqlDatabase,
  provisionRedisBinding,
  provisionPostgresDatabase,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleHostingInfraServicesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/hosting/nginx') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, {
          files: listManagedNginxConfs(ctx.dataDir),
          dataDir: ctx.dataDir,
        });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/nginx/sites') {
        ctx.auth.authenticate(getBearer(req));
        const projects = ctx.projects.list().map((p) => ({ ...p }) as Record<string, unknown>);
        const items = listMergedNginxSites({ db: ctx.db, projects });
        const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        const source = url.searchParams.get('source');
        const projectId = url.searchParams.get('projectId');
        let filtered = items;
        if (source === 'project' || source === 'standalone') {
          filtered = filtered.filter((r) => r.source === source);
        }
        if (projectId) {
          filtered = filtered.filter((r) => r.projectId === projectId);
        }
        if (q) {
          filtered = filtered.filter(
            (r) =>
              r.serverName.toLowerCase().includes(q) ||
              (r.projectName ?? '').toLowerCase().includes(q) ||
              r.target.toLowerCase().includes(q),
          );
        }
        sendJson(res, 200, { items: filtered, total: filtered.length });
        return true;
      }
      // Apply: project:ID or standalone resource uuid
      const applyMatch = url.pathname.match(
        /^\/api\/v1\/hosting\/nginx\/sites\/([^/]+)\/apply$/,
      );
      if (method === 'POST' && applyMatch) {
        const user = ctx.auth.authenticate(getBearer(req));
        const rawId = decodeURIComponent(applyMatch[1] ?? '');
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { ssl?: boolean };
        if (rawId.startsWith('project:')) {
          const projectId = rawId.slice('project:'.length);
          const result = await ctx.projectOps.publishNginx(projectId, {
            ssl: Boolean(data.ssl),
            actor: user.username,
          });
          ctx.audit.append({
            actor: user.username,
            action: 'nginx.site.apply',
            resource: rawId,
            detail: { ssl: data.ssl, ok: result.ok },
            ok: Boolean(result.ok),
          });
          sendOpsResult(res, result);
          return true;
        }
        const result = await applyManagedNginxSite(ctx.db, ctx.dataDir, rawId, {
          host: ctx.host,
          execute: true,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'nginx.site.apply',
          resource: rawId,
          detail: { ok: result.ok },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      const confMatch = url.pathname.match(
        /^\/api\/v1\/hosting\/nginx\/sites\/([^/]+)\/conf$/,
      );
      if (method === 'GET' && confMatch) {
        ctx.auth.authenticate(getBearer(req));
        const rawId = decodeURIComponent(confMatch[1] ?? '');
        if (rawId.startsWith('project:')) {
          const projectId = rawId.slice('project:'.length);
          const project = ctx.projects.get(projectId);
          const path =
            (project as { nginxConfigPath?: string } | null)?.nginxConfigPath ??
            null;
          sendJson(res, 200, {
            path,
            content: readNginxSiteConf(path),
          });
          return true;
        }
        const site = getResource(ctx.db, 'nginx_sites', rawId);
        const path = site ? String(site.confPath ?? '') || null : null;
        sendJson(res, 200, {
          path,
          content: readNginxSiteConf(path),
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/nginx/sync') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          systemConfDir?: string;
          dryRun?: boolean;
        };
        const result = await syncNginxConfigs({
          dataDir: ctx.dataDir,
          systemConfDir: data.systemConfDir,
          host: ctx.host,
          dryRun: data.dryRun,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'nginx.sync',
          detail: result,
          ok: result.ok !== false,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/probe') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { host?: string; port?: number };
        const r = await probeEndpoint(data.host ?? '127.0.0.1', data.port ?? 3306);
        sendJson(res, 200, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/mysql-plan') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dbName?: string;
          username?: string;
          password?: string;
        };
        sendJson(
          res,
          200,
          renderMysqlProvisionSql({
            dbName: data.dbName ?? 'app',
            username: data.username ?? 'appuser',
            password: data.password,
          }),
        );
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/firewall/plan') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { allowSmtp?: boolean };
        sendJson(res, 200, planFirewall({ allowSmtp: data.allowSmtp }));
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/files/plan') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, planPublicFileServer({}));
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/files/status') {
        ctx.auth.authenticate(getBearer(req));
        const { probePublicFileServer } = await import('@ysk/core');
        sendJson(res, 200, probePublicFileServer({ dataDir: ctx.dataDir, host: ctx.host }));
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/files/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          serverName?: string;
          quotaMb?: number;
          reload?: boolean;
        };
        const result = await applyPublicFileServer({
          dataDir: ctx.dataDir,
          host: ctx.host,
          serverName: data.serverName ?? 'files.local',
          quotaMb: data.quotaMb,
          reload: data.reload,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.public_files.apply',
          resource: result.serverName,
          detail: {
            ok: result.ok,
            nginxPath: result.nginxPath,
            publicRoot: result.publicRoot,
            nginxReloaded: result.nginxReloaded,
            live: result.live,
          },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/redis-provision') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          projectId?: string;
          dbIndex?: number;
          maxmemoryMb?: number;
          host?: string;
          port?: number;
          execute?: boolean;
        };
        const result = await provisionRedisBinding({
          hostExec: ctx.host,
          projectId: data.projectId ?? 'shared',
          dbIndex: data.dbIndex,
          maxmemoryMb: data.maxmemoryMb,
          redisHost: data.host,
          redisPort: data.port,
          // Panel: omit execute → apply; explicit false → dry-run
          execute: data.execute !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.redis.provision',
          detail: result,
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/postgres-provision') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dbName?: string;
          username?: string;
          password?: string;
          host?: string;
          port?: number;
          execute?: boolean;
        };
        const result = await provisionPostgresDatabase({
          dbName: data.dbName ?? 'app',
          username: data.username ?? 'appuser',
          password: data.password ?? '',
          host: data.host,
          port: data.port,
          hostExec: ctx.host,
          // Panel: omit execute → apply; explicit false → dry-run
          execute: data.execute !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.postgres.provision',
          detail: { ...result, password: undefined },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/mysql-provision') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dbName?: string;
          username?: string;
          password?: string;
          host?: string;
          execute?: boolean;
        };
        const result = await provisionMysqlDatabase({
          dbName: data.dbName ?? 'app',
          username: data.username ?? 'appuser',
          password: data.password ?? '',
          host: data.host,
          hostExec: ctx.host,
          execute: data.execute !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.mysql.provision',
          detail: { ...result, password: undefined },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }

  return false;
}
