/**
 * Project runtime ops — network, deploy helpers, status, env, backup.
 * Extracted from projects-ops.ts (Wave N3). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import {
  applyNodeHosting,
  downloadWordpressCore,
  normalizeRuntimeVersion,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleProjectsOpsRuntimeRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/network$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          domainAliases?: string[];
          forceHttps?: boolean;
          hsts?: boolean;
          siteRedirectUrl?: string | null;
          httpAuthUser?: string | null;
          httpAuthPass?: string | null;
          docRoot?: string | null;
          bindIp?: string | null;
          realIpProvider?: string | null;
          preferredPort?: number | null;
          publish?: boolean;
          ssl?: boolean;
        };
        const project = ctx.projects.updateNetwork(
          id,
          {
            domain: data.domain,
            domainAliases: data.domainAliases,
            forceHttps: data.forceHttps,
            hsts: data.hsts,
            siteRedirectUrl: data.siteRedirectUrl,
            httpAuthUser: data.httpAuthUser,
            httpAuthPass: data.httpAuthPass,
            docRoot: data.docRoot,
            bindIp: data.bindIp,
            realIpProvider: data.realIpProvider,
            preferredPort: data.preferredPort,
          },
          user.username,
        );
        if (data.publish) {
          const pub = await ctx.projectOps.publishNginx(id, {
            actor: user.username,
            ssl: data.ssl,
            forceHttps: data.forceHttps ?? project.forceHttps,
            hsts: data.hsts ?? project.hsts });
          sendJson(res, 200, { project, publish: pub });
          return true;
        }
        sendJson(res, 200, { project });
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/nginx-conf$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const path = proj.nginxConfigPath;
        if (!path) {
          sendJson(res, 200, { content: '', path: null });
          return true;
        }
        try {
          const { readFileSync, existsSync } = await import('node:fs');
          const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
          sendJson(res, 200, { content, path });
        } catch (e) {
          sendJson(res, 200, {
            content: '',
            path,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/web-stats$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const { collectProjectWebStats, recordProjectDailyStats, readProjectDailyStats } =
          await import('@ysk/core');
        const stats = await collectProjectWebStats({
          host: ctx.host,
          dataDir: ctx.dataDir,
          projectId: id,
          homeDir: proj.homeDir,
          linuxUser: proj.linuxUser });
        const daily = recordProjectDailyStats(ctx.dataDir, id, stats);
        sendJson(res, 200, {
          ...stats,
          daily: daily.series,
          history: readProjectDailyStats(ctx.dataDir, id) });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/node-apply$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          nodeVersion?: string;
          port?: number;
          enableService?: boolean;
        };
        // Low-level artifact write only; use POST .../deploy for real process
        const result = await applyNodeHosting({
          dataDir: ctx.dataDir,
          projectId: proj.id,
          projectName: proj.name,
          linuxUser: proj.linuxUser,
          homeDir: proj.homeDir,
          nodeVersion: data.nodeVersion ?? proj.runtimeVersion ?? '20',
          port: data.port ?? proj.port,
          host: ctx.host,
          enableService: data.enableService,
          nodeBinary: process.execPath });
        ctx.audit.append({
          actor: user.username,
          action: 'project.node_apply',
          resource: id,
          detail: result,
          ok: true });
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/wordpress-download$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          force?: boolean;
          forceConfig?: boolean;
          setup?: boolean;
          dbName?: string;
          dbUser?: string;
          dbPassword?: string;
          dbHost?: string;
        };
        // Default to full setup path (download + wp-config + chown + checklist)
        const useSetup = data.setup !== false;
        if (useSetup) {
          const { setupWordpress } = await import('@ysk/core');
          const result = await setupWordpress({
            host: ctx.host,
            homeDir: proj.homeDir,
            linuxUser: proj.linuxUser,
            linuxGroup: proj.linuxGroup || proj.linuxUser,
            force: data.force,
            forceConfig: data.forceConfig,
            dbName: data.dbName,
            dbUser: data.dbUser,
            dbPassword: data.dbPassword,
            dbHost: data.dbHost });
          ctx.audit.append({
            actor: user.username,
            action: 'project.wordpress_setup',
            resource: id,
            detail: { ...result, dbPassword: undefined },
            ok: result.ok });
          sendOpsResult(res, result);
          return true;
        }
        const result = await downloadWordpressCore({
          host: ctx.host,
          homeDir: proj.homeDir,
          force: data.force });
        ctx.audit.append({
          actor: user.username,
          action: 'project.wordpress_download',
          resource: id,
          detail: result,
          ok: result.ok });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/status$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const status = await ctx.projectOps.liveStatus(id);
        sendJson(res, 200, status);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/git-deploy$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          gitUrl?: string;
          branch?: string;
          redeploy?: boolean;
          entry?: string;
          skipBuild?: boolean;
        };
        const result = await ctx.projectOps.gitDeploy(id, {
          actor: user.username,
          gitUrl: data.gitUrl,
          branch: data.branch,
          redeploy: data.redeploy,
          entry: data.entry,
          skipBuild: data.skipBuild });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/env$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { env?: Record<string, string> };
        const result = ctx.projectOps.setEnv(id, data.env ?? {}, user.username);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/backup$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.backup(id, user.username);
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/runtime$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          runtimeVersion?: string;
          deployEntry?: string | null;
        };
        const p = ctx.db.snapshot.projects.find((x) => x.id === id);
        if (!p) {
          sendJson(res, 404, { ok: false, message: tl('notes.auto.n0004') });
          return true;
        }
        if (data.runtimeVersion) {
          p.runtime_version = normalizeRuntimeVersion(
            p.runtime,
            data.runtimeVersion.trim(),
          );
        }
        if (data.deployEntry !== undefined) {
          const v = data.deployEntry?.trim() || undefined;
          p.deploy_entry = v;
        }
        p.updated_at = new Date().toISOString();
        ctx.db.persist();
        ctx.audit.append({
          actor: user.username,
          action: 'project.runtime_version',
          resource: id,
          detail: {
            runtimeVersion: p.runtime_version,
            deployEntry: p.deploy_entry },
          ok: true });
        sendJson(res, 200, { project: ctx.projects.get(id) });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy-php$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          port?: number;
          phpVersion?: string;
          enableApache?: boolean;
          preferFpm?: boolean;
          forceBuiltin?: boolean;
        };
        const result = await ctx.projectOps.deployPhp(id, {
          actor: user.username,
          port: data.port,
          phpVersion: data.phpVersion,
          enableApache: data.enableApache,
          preferFpm: data.preferFpm,
          forceBuiltin: data.forceBuiltin });
        sendOpsResult(res, result);
        return true;
      }

  return false;
}
