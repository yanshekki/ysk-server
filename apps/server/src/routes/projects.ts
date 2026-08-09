import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { listAppTemplates } from '@ysk/core';
import type { ProjectDto } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

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
      if (
        method === 'GET' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy-history$/)
      ) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const limit = Math.min(50, Number(url.searchParams.get('limit') ?? 20) || 20);
        const items = ctx.audit.listForResource(id, {
          actionPrefix: 'project.deploy',
          limit });
        // Also include process deploys recorded as project.deploy_process / deploy_node / deploy_php
        const more = ctx.audit
          .listForResource(id, { limit: 80 })
          .filter((e) =>
            /deploy|git_deploy/.test(e.action),
          )
          .slice(0, limit);
        const merged = [...items, ...more]
          .filter(
            (e, i, arr) => arr.findIndex((x) => x.id === e.id) === i,
          )
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          )
          .slice(0, limit);
        sendJson(res, 200, { items: merged });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/template$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { templateId?: string; force?: boolean };
        const result = ctx.projects.applyTemplate(
          id,
          data.templateId ?? 'node-starter',
          user.username,
          data.force,
        );
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          port?: number;
          entry?: string;
          skipBuild?: boolean;
          nodeVersion?: string;
          enableSystemd?: boolean;
          preferFpm?: boolean;
          forceBuiltin?: boolean;
          ssl?: boolean;
          reload?: boolean;
        };
        const proj = ctx.projects.get(id);
        const processRuntimes = new Set([
          'python',
          'go',
          'rust',
          'java',
          'kotlin',
          'bun',
        ]);
        const result =
          proj.runtime === 'php'
            ? await ctx.projectOps.deployPhp(id, {
                actor: user.username,
                port: data.port,
                preferFpm: data.preferFpm,
                forceBuiltin: data.forceBuiltin })
            : proj.runtime === 'static'
              ? await ctx.projectOps.deployStatic(id, {
                  actor: user.username,
                  ssl: data.ssl,
                  reload: data.reload })
              : processRuntimes.has(proj.runtime)
                ? await ctx.projectOps.deployProcess(id, {
                    actor: user.username,
                    port: data.port,
                    entry: data.entry,
                    skipBuild: data.skipBuild })
                : await ctx.projectOps.deployNode(id, {
                    actor: user.username,
                    port: data.port,
                    entry: data.entry,
                    nodeVersion: data.nodeVersion,
                    enableSystemd: data.enableSystemd });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy-static$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { ssl?: boolean; reload?: boolean };
        const result = await ctx.projectOps.deployStatic(id, {
          actor: user.username,
          ssl: data.ssl,
          reload: data.reload });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-provision$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projects.provisionOsIsolation(id, user.username);
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.getOsUser(id);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          shell?: string;
          accountLocked?: boolean;
          memoryMax?: string;
          cpuQuotaPercent?: number;
          tasksMax?: number;
          limitNofile?: number;
          quotaMb?: number;
        };
        const result = await ctx.projectOps.patchOsUser(id, data, user.username);
        sendJson(res, result.ok || result.written ? 200 : 422, result);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user\/apply-limits$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.applyOsLimits(id, user.username);
        sendJson(res, result.ok || result.written ? 200 : 422, result);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user\/chown-home$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.chownOsHome(id, user.username);
        sendOpsResult(res, result);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user\/migrate$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { removePreviousHome?: boolean };
        const result = await ctx.projects.migrateOsIsolation(id, user.username, {
          removePreviousHome: data.removePreviousHome !== false });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/stop$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.stopNode(id, user.username);
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/publish-nginx$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          systemConfDir?: string;
          ssl?: boolean;
          forceHttps?: boolean;
          hsts?: boolean;
        };
        const result = await ctx.projectOps.publishNginx(id, {
          actor: user.username,
          systemConfDir: data.systemConfDir,
          ssl: data.ssl,
          forceHttps: data.forceHttps,
          hsts: data.hsts });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/purge-cache$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const { purgeNginxCache } = await import('@ysk/core');
        const r = await purgeNginxCache({ host: ctx.host });
        ctx.audit.append({
          actor: user.username,
          action: 'project.purge_cache',
          resource: id,
          detail: r,
          ok: r.ok });
        sendOpsResult(res, {
          ...r,
          projectId: id,
          notes: [
            ...r.notes,
            tl('notes.auto.n0695'),
          ] });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/suspend$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.suspend(id, user.username);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/unsuspend$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.unsuspend(id, user.username);
        sendJson(res, 200, result);
        return true;
      }
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
      if (method === 'GET' && url.pathname === '/api/v1/templates') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, { items: listAppTemplates() });
        return true;
      }
  return false;
}
