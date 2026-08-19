/**
 * DB access — adminer, temp-users, remote-hosts.
 * Extracted from db.ts (Wave M1). Behaviour preserved.
 */
import { tl } from 'ysk-server-shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleDbAccessRoutes(
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
          /** When set, create a PHP project (Adminer / phpMyAdmin) instead of global dataDir site */
          asProject?: boolean;
          projectName?: string;
          tool?: 'adminer' | 'phpmyadmin';
          engine?: 'mysql' | 'mariadb';
        };
        // New path: create real project for DB browser
        if (data.asProject === true || data.projectName || data.tool === 'phpmyadmin') {
          const { createDbBrowserProject, normalizeDbBrowserTool, defaultDbBrowserProjectName } =
            await import('ysk-server-core');
          const tool = normalizeDbBrowserTool(data.tool);
          const name =
            (data.projectName ?? '').trim() ||
            defaultDbBrowserProjectName(tool, data.engine);
          const r = await createDbBrowserProject({
            projects: ctx.projects,
            projectOps: ctx.projectOps,
            host: ctx.host,
            actor: user.username,
            actorUserId: user.id,
            name,
            domain: (data.domain ?? `${tool}.local`).trim(),
            tool,
            download: data.download !== false,
            engine: data.engine,
          });
          ctx.audit.append({
            actor: user.username,
            action: 'db.browser.project_create',
            resource: r.projectId,
            detail: { tool, name, domain: data.domain, ok: r.ok },
            ok: r.ok,
          });
          sendOpsResult(res, r);
          return true;
        }
        // Legacy: managed dataDir adminer + nginx only
        const { applyAdminer } = await import('ysk-server-core');
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
        const { expireTempDbUsers } = await import('ysk-server-core');
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
        const { listTempDbUsers } = await import('ysk-server-core');
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
        const { createTempReadonlyUser } = await import('ysk-server-core');
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
        const { listRemoteDbHosts } = await import('ysk-server-core');
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
        const host = String(data.host ?? '').trim();
        if (!host) {
          sendJson(res, 400, { ok: false, message: tl('notes.needHost') });
          return true;
        }
        const { upsertRemoteDbHost } = await import('ysk-server-core');
        const row = upsertRemoteDbHost(ctx.db, {
          id: data.id,
          engine: data.engine ?? 'mysql',
          label: data.label ?? host,
          host,
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
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/db\/temp-users\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { revokeTempDbUser } = await import('ysk-server-core');
        const r = revokeTempDbUser(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'db.temp_user.revoke',
          resource: id,
          detail: r,
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/db\/remote-hosts\/[^/]+\/test$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5] ?? '';
        const { testRemoteDbHost } = await import('ysk-server-core');
        const r = await testRemoteDbHost(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'db.remote_host.test',
          resource: id,
          detail: { ok: r.ok },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/db\/remote-hosts\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { deleteRemoteDbHost } = await import('ysk-server-core');
        const ok = deleteRemoteDbHost(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'db.remote_host.delete',
          resource: id,
          detail: { ok },
          ok });
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }

  return false;
}
