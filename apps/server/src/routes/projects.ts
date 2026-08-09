import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyNodeHosting,
  applyPhpFpmPool,
  createProjectFtpAccount,
  downloadWordpressCore,
  listAppTemplates,
  listProjectLogs,
  normalizeRuntimeVersion,
  searchProjectLogs,
  tailProjectLog,
} from '@ysk/core';
import type { ProjectDto } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';
import { handleProjectsLifecycleRoutes } from './projects-lifecycle.js';

export async function handleProjectsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/projects/isolation') {
        ctx.auth.authenticate(getBearer(req));
        const { listIsolationReport } = await import('@ysk/core');
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
        const { backfillProjectOwners } = await import('@ysk/core');
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
      if (method === 'GET' && url.pathname === '/api/v1/projects') {
        ctx.auth.authenticate(getBearer(req));
        const all = ctx.projects.list() as ProjectDto[];
        const { items, meta } = listWithQuery(
          url,
          all,
          {
            text: (p: ProjectDto) => [p.name, p.domain, p.id, p.linuxUser, p.runtime],
            predicates: {
              runtime: (p: ProjectDto, v: string) => p.runtime === v,
            },
            facetOf: {
              runtime: (p: ProjectDto) => p.runtime,
            },
            sortOf: {
              name: (a: ProjectDto, b: ProjectDto) => a.name.localeCompare(b.name),
              domain: (a: ProjectDto, b: ProjectDto) =>
                (a.domain ?? '').localeCompare(b.domain ?? ''),
            },
          },
          {
            enums: {
              runtime: ['node', 'php', 'static', 'python', 'go', 'rust'],
            },
            sortFields: ['name', 'domain'],
          },
        );
        sendJson(res, 200, { items, meta });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/wizard/create') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          projectName?: string;
          domain?: string;
          runtime?: 'node' | 'php' | 'static' | 'python' | 'go' | 'rust';
          runtimeVersion?: string;
          serverIp?: string;
          serverIpv6?: string;
          createDns?: boolean;
          createMail?: boolean;
          createDb?: boolean;
          dbName?: string;
          templateId?: string;
        };
        const { runCreateWizard } = await import('@ysk/core');
        const r = await runCreateWizard({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          projects: ctx.projects,
          email: ctx.email,
          actor: user.username,
          actorUserId: user.id,
          body: {
            projectName: data.projectName ?? '',
            domain: data.domain,
            runtime: data.runtime,
            runtimeVersion: data.runtimeVersion,
            serverIp: data.serverIp,
            serverIpv6: data.serverIpv6,
            createDns: data.createDns,
            createMail: data.createMail,
            createDb: data.createDb,
            dbName: data.dbName,
            templateId: data.templateId,
          },
        });
        ctx.audit.append({
          actor: user.username,
          action: 'wizard.create',
          detail: r,
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/projects') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          domain?: string;
          domainAliases?: string[];
          runtime?: 'node' | 'php' | 'static' | 'python' | 'go' | 'rust';
          runtimeVersion?: string;
          env?: 'staging' | 'production';
          templateId?: string;
          forceTemplate?: boolean;
          /** Deploy + publish nginx after create (default true when templateId set) */
          goLive?: boolean;
          preferredPort?: number;
          /** Also create managed DNS zone for domain */
          createDnsZone?: boolean;
          /** Also register email domain */
          createMailDomain?: boolean;
          serverIp?: string;
          serverIpv6?: string;
        };
        const { assertCanCreateProject } = await import('@ysk/core');
        assertCanCreateProject(ctx.db, user.id);
        const runtime = data.runtime ?? 'node';
        const { defaultRuntimeVersion, normalizeRuntimeVersion } = await import('@ysk/core');
        const created = await ctx.projects.create({
          name: data.name ?? '',
          domain: data.domain,
          domainAliases: data.domainAliases,
          runtime,
          runtimeVersion: normalizeRuntimeVersion(
            runtime,
            data.runtimeVersion ?? defaultRuntimeVersion(runtime),
          ),
          env: data.env,
          actor: user.username,
          actorUserId: user.id,
          templateId: data.templateId,
          forceTemplate: data.forceTemplate,
          preferredPort: data.preferredPort,
        });
        const extras: {
          dnsZoneId?: string;
          emailDomainId?: string;
          notes: string[];
          goLive?: { ok: boolean; notes: string[] };
        } = {
          notes: [],
        };
        // Template (or explicit goLive) → deploy + nginx in one shot
        const wantGoLive =
          data.goLive === true || (data.goLive !== false && Boolean(data.templateId));
        if (wantGoLive) {
          try {
            const live = await ctx.projectOps.goLive(created.project.id, {
              actor: user.username,
              port: data.preferredPort,
            });
            extras.goLive = { ok: live.ok, notes: live.notes };
            extras.notes.push(...live.notes.slice(0, 12));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            extras.goLive = { ok: false, notes: [msg] };
            extras.notes.push(`goLive: ${msg}`);
          }
        }
        const domain = (data.domain ?? '').trim().toLowerCase();
        const serverIp = (data.serverIp ?? '127.0.0.1').trim();
        const serverIpv6 = data.serverIpv6?.trim() || undefined;
        if (domain && data.createDnsZone) {
          try {
            const { createResource, seedDnsZoneRecords } = await import('@ysk/core');
            const zoneRow = createResource(ctx.db, 'dns_zones', {
              zone: domain,
              serverIp,
              ...(serverIpv6 ? { serverIpv6 } : {}),
              backend: 'bind',
              template: 'web',
              apply_status: 'draft',
              projectId: created.project.id,
            });
            seedDnsZoneRecords(
              ctx.db,
              String(zoneRow.id),
              domain,
              serverIp,
              'web',
              serverIpv6,
            );
            extras.dnsZoneId = String(zoneRow.id);
            extras.notes.push(tl('notes.auto.t0785', { v0: (domain) }));
          } catch (e) {
            extras.notes.push(
              tl('notes.auto.t0786', { v0: (e instanceof Error ? e.message : String(e)) }),
            );
          }
        }
        if (domain && data.createMailDomain) {
          try {
            const mail = ctx.email.create({
              domain,
              serverIp,
              serverIpv6,
              actor: user.username,
            });
            extras.emailDomainId = String(
              (mail as { domain?: { id?: string } }).domain?.id ??
                (mail as { id?: string }).id ??
                '',
            );
            extras.notes.push(tl('notes.auto.t0787', { v0: (domain) }));
          } catch (e) {
            extras.notes.push(
              tl('notes.auto.t0788', { v0: (e instanceof Error ? e.message : String(e)) }),
            );
          }
        }
        // Refresh project after optional goLive so port/nginx_status are current
        const project = wantGoLive
          ? ctx.projects.get(created.project.id)
          : created.project;
        sendJson(res, 201, { ...created, project, extras });
        return true;
      }
      // deploy/lifecycle → projects-lifecycle.ts (Wave H1)
      if (await handleProjectsLifecycleRoutes(ctx, req, res, url, method)) return true;

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
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        sendJson(res, 200, { project: ctx.projects.get(id) });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        let body: { confirmName?: string; removeFiles?: boolean } = {};
        try {
          const raw = await readBody(req);
          if (raw?.trim()) body = JSON.parse(raw) as typeof body;
        } catch {
          body = {};
        }
        // Also accept query params for simple clients
        if (url.searchParams.has('confirmName')) {
          body.confirmName = url.searchParams.get('confirmName') || undefined;
        }
        if (url.searchParams.has('removeFiles')) {
          body.removeFiles = url.searchParams.get('removeFiles') !== '0';
        }
        const result = await ctx.projects.delete(id, user.username, {
          confirmName: body.confirmName,
          removeFiles: body.removeFiles !== false,
        });
        sendJson(res, 200, result);
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

      if (method === 'GET' && url.pathname === '/api/v1/templates') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, { items: listAppTemplates() });
        return true;
      }
  return false;
}
