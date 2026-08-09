/**
 * Project ops — network, logs, ftp, php, quota, status, … 
 * Extracted from projects.ts (Wave H2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import {
  applyNodeHosting,
  applyPhpFpmPool,
  createProjectFtpAccount,
  downloadWordpressCore,
  listProjectLogs,
  normalizeRuntimeVersion,
  searchProjectLogs,
  tailProjectLog,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleProjectsOpsRoutes(
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
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/logs$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const extraDirs = proj.logExtraDirs ?? [];
        const nameFilter = url.searchParams.get('name') || undefined;
        const grep = url.searchParams.get('grep') || undefined;
        const files = listProjectLogs(proj.homeDir, {
          extraDirs,
          nameFilter });
        const { listProjectRelatedLogSources } = await import('@ysk/core');
        const related = listProjectRelatedLogSources({
          projectId: proj.id,
          linuxUser: proj.linuxUser,
          runtime: proj.runtime,
          dataDir: ctx.dataDir,
          phpVersion: proj.runtimeVersion });
        const file = url.searchParams.get('file');
        if (file) {
          const lines = Number(url.searchParams.get('lines') ?? 200);
          sendJson(res, 200, {
            files,
            extraDirs,
            related,
            tail: tailProjectLog(
              proj.homeDir,
              file,
              Number.isFinite(lines) ? lines : 200,
              2 * 1024 * 1024,
              { extraDirs, grep },
            ) });
          return true;
        }
        if (grep) {
          const result = searchProjectLogs(proj.homeDir, {
            extraDirs,
            nameFilter,
            grep });
          sendJson(res, 200, {
            files: result.files,
            hits: result.hits,
            notes: result.notes,
            extraDirs,
            related });
          return true;
        }
        sendJson(res, 200, { files, extraDirs, related });
        return true;
      }
      if (
        method === 'PUT' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/log-dirs$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        let data: { dirs?: unknown } = {};
        try {
          data = raw ? (JSON.parse(raw) as { dirs?: unknown }) : {};
        } catch {
          sendJson(res, 400, { ok: false, message: tl('errors.http.jsonInvalid') });
          return true;
        }
        const result = ctx.projects.setLogExtraDirs(
          id,
          (data.dirs as string[]) ?? [],
          user.username,
        );
        sendJson(res, 200, {
          ok: true,
          project: result.project,
          extraDirs: result.project.logExtraDirs ?? [],
          notes: result.notes });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/ftp$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          username?: string;
          password?: string;
          homeSubdir?: 'app' | 'root';
        };
        const result = createProjectFtpAccount(ctx.db, {
          projectId: proj.id,
          projectHome: proj.homeDir,
          linuxUser: proj.linuxUser,
          linuxGroup: proj.linuxGroup || proj.linuxUser,
          username: data.username,
          password: data.password ?? '',
          homeSubdir: data.homeSubdir });
        // Best-effort chown jail when root (before vsftpd apply)
        if (
          result.ok &&
          ctx.host.executeEnabled() &&
          ctx.host.isRoot() &&
          proj.linuxUser &&
          result.account?.homePath
        ) {
          const { chownProjectPath } = await import('@ysk/core');
          const ch = await chownProjectPath(
            ctx.host,
            {
              linuxUser: proj.linuxUser,
              linuxGroup: proj.linuxGroup || proj.linuxUser,
              homeDir: proj.homeDir },
            String(result.account.homePath),
          );
          result.notes.push(...ch.notes);
        }
        ctx.audit.append({
          actor: user.username,
          action: 'project.ftp.create',
          resource: id,
          detail: result,
          ok: result.ok });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/resources$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          memoryMax?: string;
          cpuQuotaPercent?: number;
          tasksMax?: number;
          limitNofile?: number;
        };
        const result = ctx.projectOps.setResources(id, data, user.username);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/quota$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { quotaMb?: number };
        const result = await ctx.projectOps.setQuota(id, data.quotaMb ?? 1024, user.username);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/quota$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        sendJson(res, 200, await ctx.projectOps.quotaStatus(id));
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/php-fpm$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { enable?: boolean; phpVersion?: string };
        const phpVersion = data.phpVersion ?? proj.runtimeVersion ?? '8.2';
        if (data.phpVersion) {
          const prow = ctx.db.snapshot.projects.find((p) => p.id === id);
          if (prow) {
            prow.runtime_version = phpVersion;
            prow.updated_at = new Date().toISOString();
            ctx.db.persist();
          }
        }
        const {
          loadPhpIniSettings,
          loadProjectPhpIni,
          mergePhpIni,
          renderPhpAdminValueLines } = await import('@ysk/core');
        const adminValueLines = renderPhpAdminValueLines(
          mergePhpIni(
            loadPhpIniSettings(ctx.dataDir, phpVersion),
            loadProjectPhpIni(ctx.dataDir, id, phpVersion),
          ),
        );
        const result = await applyPhpFpmPool({
          dataDir: ctx.dataDir,
          poolName: proj.linuxUser,
          linuxUser: proj.linuxUser,
          phpVersion,
          host: ctx.host,
          enable: data.enable,
          adminValueLines });
        ctx.audit.append({
          actor: user.username,
          action: 'project.php_fpm',
          resource: id,
          detail: { ...result, phpVersion, adminValueCount: adminValueLines.length },
          ok: result.ok });
        sendJson(res, result.ok || !data.enable ? 200 : 422, {
          ...result,
          phpVersion,
          adminValueCount: adminValueLines.length,
          project: ctx.projects.get(id) });
        return true;
      }
      // —— Project-level PHP ini overrides ——
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/php-ini$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const version =
          url.searchParams.get('version') ?? proj.runtimeVersion ?? '8.2';
        const {
          getPhpIni,
          loadProjectPhpIni,
          mergePhpIni,
          loadPhpIniSettings,
          listPhpIniCatalog,
          renderPhpAdminValueLines } = await import('@ysk/core');
        const global = getPhpIni(ctx.dataDir, version);
        const project = loadProjectPhpIni(ctx.dataDir, id, version);
        const effective = mergePhpIni(loadPhpIniSettings(ctx.dataDir, version), project);
        sendJson(res, 200, {
          version,
          catalog: listPhpIniCatalog(),
          global: global.settings,
          project,
          effective,
          adminValuePreview: renderPhpAdminValueLines(effective),
          notes: [
            tl('notes.auto.n0698'),
            tl('notes.auto.n1503'),
          ] });
        return true;
      }
      if (method === 'PUT' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/php-ini$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          version?: string;
          values?: Record<string, string | number | boolean>;
          extra?: Record<string, string>;
          rawAppend?: string;
        };
        const { saveProjectPhpIni } = await import('@ysk/core');
        const result = saveProjectPhpIni(ctx.dataDir, id, {
          version: data.version ?? proj.runtimeVersion ?? '8.2',
          values: data.values ?? {},
          extra: data.extra ?? {},
          rawAppend: data.rawAppend ?? '' });
        ctx.audit.append({
          actor: user.username,
          action: 'project.php_ini.save',
          resource: id,
          detail: { written: result.written },
          ok: true });
        sendJson(res, 200, {
          ok: true,
          settings: result.settings,
          written: result.written,
          notes: [tl('notes.auto.n0733')] });
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
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/usage$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        sendJson(res, 200, await ctx.projectOps.quotaStatus(id));
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
