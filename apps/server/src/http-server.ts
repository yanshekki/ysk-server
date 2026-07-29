/**
 * Control-plane HTTP API — real auth, tools, projects, audit.
 */

import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  CLI_NAME,
  PRODUCT_NAME,
  YskError,
  type HealthResponse,
  type ResourceScope,
  type SystemRole,
} from '@ysk/shared';
import {
  checkRbac,
  collectInventory,
  adviseInventory,
  applyNodeHosting,
  collectMetrics,
  executeToolCall,
  evaluateProtection,
  getPlaybook,
  listPlaybooks,
  listManagedNginxConfs,
  planDnsZone,
  writeManagedDnsZone,
  listManagedDnsZones,
  applyPowerDnsZone,
  powerDnsStatus,
  installPowerDnsPackages,
  probeRuntimes,
  planOrInstallRuntime,
  writeDovecotPassdb,
  writeAllDovecotPassdbs,
  listSupportedRuntimes,
  applyWebmail,
  bootstrapEmailServer,
  assessProductionReadiness,
  applyPublicFileServer,
  planFirewall,
  planPublicFileServer,
  probeEndpoint,
  renderMysqlProvisionSql,
  runLiveEmailChecks,
  startPlaybookRun,
  syncNginxConfigs,
  buildRcaReport,
  planSelfUpdate,
  provisionMysqlDatabase,
  listBackups,
  backupAllProjects,
  restoreProjectBackup,
  deleteProjectBackup,
  resolveBackupDownloadPath,
  createProjectFtpAccount,
  listProjectLogs,
  tailProjectLog,
  lookupOsvVulns,
  uploadCertificate,
  listUploadedCertFiles,
  applyPhpFpmPool,
  applyCloudflareDns,
  persistDnsZoneApply,
  checkIpDnsbl,
  planEmailWarmup,
  probeAllAgentRuntimes,
  probeAgentRuntime,
  planAgentInstall,
  parseAgentKind,
  renderAgentSystemdUnit,
  applyAgentInstall,
  applySmtpRelay,
  loadSmtpRelaySettings,
  listAppTemplates,
  provisionRedisBinding,
  downloadWordpressCore,
  provisionPostgresDatabase,
  normalizeRuntimeVersion,
} from '@ysk/core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyProtection, type AppContext } from './app-context.js';
import { VERSION } from './version.js';
import { getBearer, parseUrl, readBody, sendError, sendJson } from './http/util.js';
import { handleFilesRoutes } from './controllers/files-controller.js';
import { handleSystemRoutes } from './controllers/system-controller.js';
import { handleResourcesRoutes } from './controllers/resources-controller.js';
import { handleLogsRoutes } from './controllers/logs-controller.js';
import { resolveWebRoot, tryServeStatic } from './http/static.js';

export function createHttpServer(ctx: AppContext): Server {
  const webRoot = resolveWebRoot(ctx.webRoot);

  return createServer(async (req, res) => {
    try {
      // rate window for protection heuristics
      ctx.requestHits.push(Date.now());
      if (ctx.requestHits.length > 10_000) {
        const cutoff = Date.now() - 60_000;
        ctx.requestHits = ctx.requestHits.filter((t) => t >= cutoff);
      }

      const url = parseUrl(req);
      const method = req.method ?? 'GET';

      // Modular controllers first (WebDAV needs OPTIONS/PROPFIND)
      if (await handleFilesRoutes(ctx, req, res, url, method)) return;

      if (method === 'OPTIONS') {
        return sendJson(res, 204, {});
      }

      if (await handleResourcesRoutes(ctx, req, res, url, method)) return;
      if (await handleLogsRoutes(ctx, req, res, url, method)) return;
      if (await handleSystemRoutes(ctx, req, res, url, method)) return;

      if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/v1/health')) {
        const executeEnabled = ctx.host.executeEnabled();
        const isRoot = ctx.host.isRoot();
        const body: HealthResponse = {
          status: ctx.protection.mode === 'normal' ? 'ok' : 'degraded',
          product: PRODUCT_NAME,
          version: ctx.version || VERSION,
          protectionMode: ctx.protection.mode,
          timestamp: new Date().toISOString(),
          executeEnabled,
          isRoot,
          mode: executeEnabled && isRoot ? 'production_capable' : 'degraded',
        };
        return sendJson(res, 200, body);
      }

      // —— Public mail client autodiscover (no auth) ——
      // Mozilla: /.well-known/autoconfig/mail/config-v1.1.xml?domain=
      //          /mail/config-v1.1.xml?domain=
      // Outlook: /autodiscover/autodiscover.xml?email=
      if (
        method === 'GET' &&
        (url.pathname === '/mail/config-v1.1.xml' ||
          url.pathname === '/.well-known/autoconfig/mail/config-v1.1.xml' ||
          url.pathname === '/autodiscover/autodiscover.xml' ||
          url.pathname.toLowerCase() === '/autodiscover/autodiscover.xml')
      ) {
        const { renderMozillaAutoconfig, renderOutlookAutodiscover } = await import('@ysk/core');
        let domain =
          url.searchParams.get('domain')?.trim().toLowerCase() ||
          url.searchParams.get('emailaddress')?.split('@')[1]?.toLowerCase() ||
          url.searchParams.get('email')?.split('@')[1]?.toLowerCase() ||
          '';
        if (!domain) {
          // Outlook sometimes POSTs; GET with empty → 400
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('domain or email query required');
          return;
        }
        const known = ctx.email.list().find((d) => d.domain === domain);
        const mailHost = known?.mail_hostname || `mail.${domain}`;
        if (url.pathname.includes('autodiscover')) {
          const email =
            url.searchParams.get('email') ||
            url.searchParams.get('emailaddress') ||
            `user@${domain}`;
          const xml = renderOutlookAutodiscover({
            domain,
            email,
            imapHost: mailHost,
            smtpHost: mailHost,
          });
          res.writeHead(200, {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          });
          res.end(xml);
          return;
        }
        const xml = renderMozillaAutoconfig({
          domain,
          imapHost: mailHost,
          smtpHost: mailHost,
        });
        res.writeHead(200, {
          'Content-Type': 'text/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        });
        res.end(xml);
        return;
      }

      if (method === 'GET' && url.pathname === '/api/v1/status') {
        return sendJson(res, 200, {
          product: PRODUCT_NAME,
          cli: CLI_NAME,
          version: VERSION,
          startedAt: ctx.startedAt,
          protection: ctx.protection,
          dataDir: ctx.dataDir,
          executeEnabled: ctx.host.executeEnabled(),
          isRoot: ctx.host.isRoot(),
          webUi: Boolean(webRoot),
          webRoot: webRoot ?? null,
          mode: ctx.host.executeEnabled() && ctx.host.isRoot() ? 'production_capable' : 'degraded',
          tools: ctx.allowlist.list().map((t) => t.tool),
        });
      }

      if (method === 'GET' && url.pathname === '/api/v1/readiness') {
        // Public-ish for install probes; still auth optional for detail
        try {
          ctx.auth.authenticate(getBearer(req));
        } catch {
          /* allow unauthenticated summary for health gates */
        }
        const projects = ctx.projects.list().map((p) => ({
          id: p.id,
          name: p.name,
          linuxUser: p.linuxUser,
          homeDir: p.homeDir,
          osProvisioned: Boolean(p.osProvisioned),
        }));
        const report = await assessProductionReadiness({
          dataDir: ctx.dataDir,
          host: ctx.host,
          product: PRODUCT_NAME,
          version: VERSION,
          projects,
        });
        return sendJson(res, report.productionReady ? 200 : 503, report);
      }

      if (method === 'POST' && url.pathname === '/api/v1/auth/login') {
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          username?: string;
          password?: string;
          totp?: string;
        };
        try {
          const result = ctx.auth.login({
            username: data.username ?? '',
            password: data.password ?? '',
            totp: data.totp,
          });
          return sendJson(res, 200, result);
        } catch (e) {
          if (e instanceof YskError && e.details && (e.details as { needsTotp?: boolean }).needsTotp) {
            return sendJson(res, 401, {
              ok: false,
              code: e.code,
              message: e.message,
              needsTotp: true,
            });
          }
          throw e;
        }
      }

      if (method === 'POST' && url.pathname === '/api/v1/auth/logout') {
        ctx.auth.logout(getBearer(req));
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'GET' && url.pathname === '/api/v1/auth/me') {
        const user = ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { user });
      }

      // —— Users & packages (admin) ——
      if (method === 'GET' && url.pathname === '/api/v1/users') {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles.includes('admin')) {
          return sendJson(res, 403, { ok: false, message: '需要管理員權限' });
        }
        return sendJson(res, 200, { items: ctx.usersAdmin.listUsers() });
      }
      if (method === 'POST' && url.pathname === '/api/v1/users') {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles.includes('admin')) {
          return sendJson(res, 403, { ok: false, message: '需要管理員權限' });
        }
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          username?: string;
          password?: string;
          roles?: Array<'admin' | 'operator' | 'viewer' | 'agent'>;
          packageId?: string;
        };
        const created = ctx.usersAdmin.createUser({
          username: data.username ?? '',
          password: data.password ?? '',
          roles: data.roles,
          packageId: data.packageId,
          actor: user.username,
        });
        return sendJson(res, 201, { user: created });
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/users\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles.includes('admin')) {
          return sendJson(res, 403, { ok: false, message: '需要管理員權限' });
        }
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          roles?: Array<'admin' | 'operator' | 'viewer' | 'agent'>;
          packageId?: string | null;
          suspended?: boolean;
          password?: string;
        };
        const updated = ctx.usersAdmin.updateUser(id, data, user.username);
        return sendJson(res, 200, { user: updated });
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/users\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles.includes('admin')) {
          return sendJson(res, 403, { ok: false, message: '需要管理員權限' });
        }
        const id = url.pathname.split('/')[4];
        const ok = ctx.usersAdmin.deleteUser(id, user.username);
        return sendJson(res, ok ? 200 : 404, { ok });
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/users\/[^/]+\/impersonate$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = ctx.usersAdmin.impersonate(id, {
          id: user.id,
          username: user.username,
          roles: user.roles,
        });
        return sendJson(res, 200, result);
      }
      if (method === 'GET' && url.pathname === '/api/v1/packages') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: ctx.usersAdmin.listPackages() });
      }
      if (method === 'POST' && url.pathname === '/api/v1/packages') {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles.includes('admin')) {
          return sendJson(res, 403, { ok: false, message: '需要管理員權限' });
        }
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          maxProjects?: number;
          maxMailboxes?: number;
          maxDatabases?: number;
          diskMb?: number;
          bandwidthMb?: number;
          allowSsh?: boolean;
          allowFtp?: boolean;
          notes?: string;
        };
        const pkg = ctx.usersAdmin.createPackage(
          {
            name: data.name ?? '',
            maxProjects: data.maxProjects,
            maxMailboxes: data.maxMailboxes,
            maxDatabases: data.maxDatabases,
            diskMb: data.diskMb,
            bandwidthMb: data.bandwidthMb,
            allowSsh: data.allowSsh,
            allowFtp: data.allowFtp,
            notes: data.notes,
          },
          user.username,
        );
        return sendJson(res, 201, { package: pkg });
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/packages\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles.includes('admin')) {
          return sendJson(res, 403, { ok: false, message: '需要管理員權限' });
        }
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as Record<string, unknown>;
        const pkg = ctx.usersAdmin.updatePackage(
          id,
          {
            name: data.name as string | undefined,
            max_projects: data.max_projects as number | undefined,
            max_mailboxes: data.max_mailboxes as number | undefined,
            max_databases: data.max_databases as number | undefined,
            disk_mb: data.disk_mb as number | undefined,
            bandwidth_mb: data.bandwidth_mb as number | undefined,
            allow_ssh: data.allow_ssh as boolean | undefined,
            allow_ftp: data.allow_ftp as boolean | undefined,
            notes: data.notes as string | undefined,
          },
          user.username,
        );
        return sendJson(res, 200, { package: pkg });
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/packages\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles.includes('admin')) {
          return sendJson(res, 403, { ok: false, message: '需要管理員權限' });
        }
        const id = url.pathname.split('/')[4];
        const ok = ctx.usersAdmin.deletePackage(id, user.username);
        return sendJson(res, ok ? 200 : 404, { ok });
      }

      if (method === 'GET' && url.pathname === '/api/v1/search') {
        ctx.auth.authenticate(getBearer(req));
        const q = url.searchParams.get('q') ?? '';
        const { globalSearch } = await import('@ysk/core');
        return sendJson(res, 200, { items: globalSearch(ctx.db, q) });
      }

      if (method === 'GET' && url.pathname === '/api/v1/system/ips') {
        ctx.auth.authenticate(getBearer(req));
        const r = await ctx.host.runCommand(
          ['bash', '-c', "hostname -I 2>/dev/null || ip -4 -o addr show | awk '{print $4}'"],
          { timeoutMs: 5_000 },
        );
        const ips = (r.stdout || '')
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean);
        return sendJson(res, 200, { items: ips });
      }

      if (method === 'GET' && url.pathname === '/api/v1/runtimes/tools') {
        ctx.auth.authenticate(getBearer(req));
        const { probeRuntimeTools } = await import('@ysk/core');
        return sendJson(res, 200, await probeRuntimeTools(ctx.host));
      }

      if (method === 'POST' && url.pathname === '/api/v1/db/adminer/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { domain?: string; download?: boolean };
        const { applyAdminer } = await import('@ysk/core');
        const r = await applyAdminer({
          dataDir: ctx.dataDir,
          host: ctx.host,
          domain: data.domain,
          download: data.download !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'db.adminer.apply',
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 422, r);
      }

      // system/export|exports|managed-nginx|rebuild → handleSystemRoutes (system-controller)

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/dns\/zones\/[^/]+\/dnssec$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const zone = decodeURIComponent(url.pathname.split('/')[5] ?? '');
        const { generateDnssecKeys } = await import('@ysk/core');
        const r = await generateDnssecKeys({
          dataDir: ctx.dataDir,
          zone,
          host: ctx.host,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'dns.dnssec.generate',
          resource: zone,
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 422, r);
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/dns\/zones\/[^/]+\/dnssec$/)) {
        ctx.auth.authenticate(getBearer(req));
        const zone = decodeURIComponent(url.pathname.split('/')[5] ?? '');
        const { listDnssecMaterial } = await import('@ysk/core');
        return sendJson(res, 200, listDnssecMaterial(ctx.dataDir, zone));
      }

      if (method === 'GET' && url.pathname === '/api/v1/sftp/keys') {
        ctx.auth.authenticate(getBearer(req));
        const username = url.searchParams.get('username') ?? undefined;
        const { listSftpKeys } = await import('@ysk/core');
        return sendJson(res, 200, { items: listSftpKeys(ctx.db, username || undefined) });
      }
      if (method === 'POST' && url.pathname === '/api/v1/sftp/keys') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          username?: string;
          publicKey?: string;
          comment?: string;
          projectId?: string;
        };
        const { addSftpKey, chownSftpProjectKeys } = await import('@ysk/core');
        let linuxUser: string | undefined;
        let homeDir: string | undefined;
        let username = data.username ?? '';
        if (data.projectId) {
          try {
            const proj = ctx.projects.get(data.projectId);
            linuxUser = proj.linuxUser;
            homeDir = proj.homeDir;
            username = username || proj.linuxUser;
          } catch {
            /* invalid project */
          }
        }
        const r = addSftpKey(ctx.db, ctx.dataDir, {
          username,
          publicKey: data.publicKey ?? '',
          comment: data.comment,
          projectId: data.projectId,
          linuxUser,
          homeDir,
        });
        if (r.ok && homeDir && linuxUser) {
          const ch = await chownSftpProjectKeys(ctx.host, homeDir, linuxUser);
          r.notes.push(...ch);
        }
        ctx.audit.append({
          actor: user.username,
          action: 'sftp.key.add',
          detail: {
            username: data.username,
            projectId: data.projectId,
            ok: r.ok,
          },
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 201 : 422, r);
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/sftp\/keys\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { removeSftpKey } = await import('@ysk/core');
        const r = removeSftpKey(ctx.db, ctx.dataDir, id);
        ctx.audit.append({
          actor: user.username,
          action: 'sftp.key.remove',
          resource: id,
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 404, r);
      }

      if (method === 'GET' && url.pathname === '/api/v1/sftp/sshd-snippet') {
        ctx.auth.authenticate(getBearer(req));
        const { buildSshdSftpSnippet } = await import('@ysk/core');
        const chroot = url.searchParams.get('chroot') === '1';
        const snippet = buildSshdSftpSnippet({ chroot });
        return sendJson(res, 200, {
          snippet,
          notes: [
            '將片段 Include 到 sshd_config，或 POST /api/v1/sftp/sshd-snippet/apply 安裝',
            'Match User ysks_*,ysk_* + internal-sftp + AuthorizedKeysFile .ssh/authorized_keys',
          ],
        });
      }

      if (method === 'POST' && url.pathname === '/api/v1/sftp/sshd-snippet/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          chroot?: boolean;
          installSystem?: boolean;
        };
        const { applySshdSftpSnippet } = await import('@ysk/core');
        const r = await applySshdSftpSnippet({
          dataDir: ctx.dataDir,
          host: ctx.host,
          db: ctx.db,
          chroot: data.chroot,
          installSystem: data.installSystem !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'sftp.sshd_snippet.apply',
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, r.ok || r.written.length ? 200 : 422, r);
      }

      if (method === 'GET' && url.pathname === '/api/v1/auth/totp') {
        const user = ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, ctx.auth.totpStatus(user.id));
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/totp/begin') {
        const user = ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, ctx.auth.beginTotp(user.id));
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/totp/confirm') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { code?: string };
        return sendJson(res, 200, ctx.auth.confirmTotp(user.id, data.code ?? ''));
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/totp/disable') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { code?: string };
        return sendJson(res, 200, ctx.auth.disableTotp(user.id, data.code ?? ''));
      }

      if (method === 'GET' && url.pathname === '/api/v1/auth/api-keys') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { listApiKeys } = await import('@ysk/core');
        void user;
        return sendJson(res, 200, { items: listApiKeys(ctx.db) });
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/api-keys') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { name?: string };
        const { createApiKey } = await import('@ysk/core');
        const created = createApiKey(ctx.db, { name: data.name ?? 'api-key', userId: user.id });
        ctx.audit.append({
          actor: user.username,
          action: 'auth.api_key.create',
          detail: { id: created.key.id, name: created.key.name },
          ok: true,
        });
        return sendJson(res, 201, created);
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/auth\/api-keys\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { deleteApiKey } = await import('@ysk/core');
        const ok = deleteApiKey(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'auth.api_key.delete',
          resource: id,
          detail: { ok },
          ok,
        });
        return sendJson(res, ok ? 200 : 404, { ok });
      }

      if (method === 'GET' && url.pathname === '/api/v1/audit') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: ctx.audit.listRecent(100) });
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
          limit,
        });
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
        return sendJson(res, 200, { items: merged });
      }

      if (method === 'GET' && url.pathname === '/api/v1/projects') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: ctx.projects.list() });
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
        return sendJson(res, r.ok ? 201 : 422, r);
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
          templateId: data.templateId,
          forceTemplate: data.forceTemplate,
        });
        const extras: { dnsZoneId?: string; emailDomainId?: string; notes: string[] } = {
          notes: [],
        };
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
            extras.notes.push(`DNS zone 已建立（draft）: ${domain}`);
          } catch (e) {
            extras.notes.push(
              `DNS zone 建立失敗: ${e instanceof Error ? e.message : String(e)}`,
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
            extras.notes.push(`郵件域名已登記: ${domain}`);
          } catch (e) {
            extras.notes.push(
              `郵件域名建立失敗: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        return sendJson(res, 201, { ...created, extras });
      }

      if (method === 'GET' && url.pathname === '/api/v1/templates') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: listAppTemplates() });
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
        return sendJson(res, 200, result);
      }

      // Project ops — specific paths before generic :id
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
        const result =
          proj.runtime === 'php'
            ? await ctx.projectOps.deployPhp(id, {
                actor: user.username,
                port: data.port,
                preferFpm: data.preferFpm,
                forceBuiltin: data.forceBuiltin,
              })
            : proj.runtime === 'static'
              ? await ctx.projectOps.deployStatic(id, {
                  actor: user.username,
                  ssl: data.ssl,
                  reload: data.reload,
                })
              : proj.runtime === 'python' ||
                  proj.runtime === 'go' ||
                  proj.runtime === 'rust'
                ? await ctx.projectOps.deployProcess(id, {
                    actor: user.username,
                    port: data.port,
                    entry: data.entry,
                    skipBuild: data.skipBuild,
                  })
                : await ctx.projectOps.deployNode(id, {
                    actor: user.username,
                    port: data.port,
                    entry: data.entry,
                    nodeVersion: data.nodeVersion,
                    enableSystemd: data.enableSystemd,
                  });
        return sendJson(res, result.ok ? 200 : 502, result);
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy-static$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { ssl?: boolean; reload?: boolean };
        const result = await ctx.projectOps.deployStatic(id, {
          actor: user.username,
          ssl: data.ssl,
          reload: data.reload,
        });
        return sendJson(res, result.ok ? 200 : 502, result);
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-provision$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projects.provisionOsIsolation(id, user.username);
        return sendJson(res, result.ok ? 200 : 422, result);
      }

      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.getOsUser(id);
        return sendJson(res, 200, result);
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
        return sendJson(res, result.ok || result.written ? 200 : 422, result);
      }

      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user\/apply-limits$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.applyOsLimits(id, user.username);
        return sendJson(res, result.ok || result.written ? 200 : 422, result);
      }

      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user\/chown-home$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.chownOsHome(id, user.username);
        return sendJson(res, result.ok ? 200 : 422, result);
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
          removePreviousHome: data.removePreviousHome !== false,
        });
        return sendJson(res, result.ok ? 200 : 422, result);
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/stop$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.stopNode(id, user.username);
        return sendJson(res, 200, result);
      }

      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/health$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.health(id);
        return sendJson(res, result.ok ? 200 : 503, result);
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
          hsts: data.hsts,
        });
        return sendJson(res, 200, result);
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
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 422, {
          ...r,
          projectId: id,
          notes: [
            ...r.notes,
            '專案級 purge 目前清主機共用 nginx cache 目錄（非 per-vhost zone）',
          ],
        });
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/suspend$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.suspend(id, user.username);
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/unsuspend$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.unsuspend(id, user.username);
        return sendJson(res, 200, result);
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
          },
          user.username,
        );
        if (data.publish) {
          const pub = await ctx.projectOps.publishNginx(id, {
            actor: user.username,
            ssl: data.ssl,
            forceHttps: data.forceHttps ?? project.forceHttps,
            hsts: data.hsts ?? project.hsts,
          });
          return sendJson(res, 200, { project, publish: pub });
        }
        return sendJson(res, 200, { project });
      }

      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        return sendJson(res, 200, { project: ctx.projects.get(id) });
      }

      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        await ctx.projects.delete(id, user.username);
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'POST' && url.pathname === '/api/v1/agents/register') {
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { agentId?: string };
        const session = ctx.agents.register(data.agentId ?? '');
        ctx.audit.append({
          actor: data.agentId ?? 'agent',
          action: 'agent.register',
          detail: session,
          ok: true,
        });
        return sendJson(res, 200, session);
      }

      // Managed AI agent runtimes (OpenClaw / Hermes / IonClaw)
      if (method === 'GET' && url.pathname === '/api/v1/agents/runtimes') {
        ctx.auth.authenticate(getBearer(req));
        const probes = await probeAllAgentRuntimes(ctx.host);
        return sendJson(res, 200, { items: probes });
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const kind = url.pathname.split('/')[5];
        const probe = await probeAgentRuntime(kind, ctx.host);
        return sendJson(res, 200, { runtime: probe });
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+\/plan$/)) {
        ctx.auth.authenticate(getBearer(req));
        const kind = parseAgentKind(url.pathname.split('/')[5]);
        return sendJson(res, 200, planAgentInstall(kind));
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+\/unit$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const kind = parseAgentKind(url.pathname.split('/')[5]);
        const plan = planAgentInstall(kind);
        const unitsDir = join(ctx.dataDir, 'systemd');
        mkdirSync(unitsDir, { recursive: true });
        const unitName = `ysk-agent-${kind}.service`;
        const unitPath = join(unitsDir, unitName);
        const content = renderAgentSystemdUnit({
          kind,
          installPath: plan.runtime.installPath ?? `/opt/ysk-server/agents/${kind}`,
          nodePath: process.execPath,
        });
        writeFileSync(unitPath, content, 'utf8');
        ctx.audit.append({
          actor: user.username,
          action: 'agent.unit.write',
          resource: kind,
          detail: { unitPath },
          ok: true,
        });
        return sendJson(res, 200, {
          ok: true,
          unitPath,
          unitName,
          notes: [
            `Unit template written to ${unitPath}`,
            'Enable with root + YSK_EXECUTE: cp to /etc/systemd/system && systemctl enable --now',
          ],
        });
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+\/install$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const kind = parseAgentKind(url.pathname.split('/')[5]);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { execute?: boolean; enableUnit?: boolean };
        const result = await applyAgentInstall({
          dataDir: ctx.dataDir,
          kind,
          host: ctx.host,
          execute: data.execute,
          enableUnit: data.enableUnit,
          nodePath: process.execPath,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'agent.install',
          resource: kind,
          detail: {
            ok: result.ok,
            enabled: result.enabled,
            requiresExecute: result.requiresExecute,
            notes: result.notes,
          },
          ok: result.ok,
        });
        return sendJson(res, result.ok || !data.execute ? 200 : 422, result);
      }

      if (method === 'GET' && url.pathname === '/api/v1/dashboard/summary') {
        ctx.auth.authenticate(getBearer(req));
        const projects = ctx.projects.list();
        const agentRuntimes = await probeAllAgentRuntimes(ctx.host);
        const lastDnsbl = ctx.settings.getJson<Record<string, unknown>>('last_dnsbl_run');
        const lastBackup = ctx.settings.getJson<Record<string, unknown>>('last_backup_run');
        const lastInventory = ctx.settings.getJson<Record<string, unknown>>('last_inventory');
        const relay = ctx.settings.get('email.smtp_relay');
        return sendJson(res, 200, {
          projects: {
            total: projects.length,
            running: projects.filter((p) => p.processStatus === 'running').length,
            items: projects.slice(0, 8).map((p) => ({
              id: p.id,
              name: p.name,
              processStatus: p.processStatus,
              port: p.port,
            })),
          },
          agents: {
            items: agentRuntimes.map((a) => ({
              kind: a.kind,
              name: a.name,
              status: a.status,
              unitActive: a.unitActive,
            })),
          },
          email: {
            domains: ctx.email.list().length,
            lastDnsbl: lastDnsbl ?? null,
            smtpRelay: relay ? JSON.parse(relay) : loadSmtpRelaySettings(ctx.dataDir),
          },
          ops: {
            lastBackup: lastBackup ?? null,
            lastInventory: lastInventory
              ? { at: lastInventory.at, count: lastInventory.count }
              : null,
            scheduler: ctx.scheduler.list(),
          },
        });
      }

      if (method === 'GET' && url.pathname === '/api/v1/notifications') {
        ctx.auth.authenticate(getBearer(req));
        const { collectNotifications } = await import('@ysk/core');
        const r = await collectNotifications({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          executeEnabled: ctx.host.executeEnabled(),
          lastBackup: ctx.settings.getJson<Record<string, unknown>>('last_backup_run'),
          lastDnsbl: ctx.settings.getJson<Record<string, unknown>>('last_dnsbl_run'),
        });
        return sendJson(res, 200, r);
      }

      if (method === 'GET' && url.pathname === '/api/v1/system/apply-audit') {
        ctx.auth.authenticate(getBearer(req));
        const { auditApplyStatuses } = await import('@ysk/core');
        return sendJson(res, 200, auditApplyStatuses(ctx.db));
      }

      if (method === 'POST' && url.pathname === '/api/v1/email/relay') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          host?: string;
          port?: number;
          username?: string;
          password?: string;
          security?: 'none' | 'starttls' | 'tls';
          domain?: string;
          applySystem?: boolean;
        };
        const result = await applySmtpRelay({
          dataDir: ctx.dataDir,
          host: ctx.host,
          relay: {
            host: data.host ?? '',
            port: data.port ?? 587,
            username: data.username,
            password: data.password,
            security: data.security ?? 'starttls',
            domain: data.domain,
          },
          applySystem: data.applySystem,
          db: ctx.db,
          actor: user.username,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.relay.apply',
          detail: { ...result, config: result.config },
          ok: result.ok,
        });
        return sendJson(res, result.ok || !data.applySystem ? 200 : 422, result);
      }
      if (method === 'GET' && url.pathname === '/api/v1/email/relay') {
        ctx.auth.authenticate(getBearer(req));
        const stored = ctx.settings.get('email.smtp_relay');
        return sendJson(res, 200, {
          settings: stored ? JSON.parse(stored) : null,
          files: loadSmtpRelaySettings(ctx.dataDir),
        });
      }

      if (method === 'POST' && url.pathname === '/api/v1/tools/execute') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          tool?: string;
          args?: Record<string, unknown>;
          dryRun?: boolean;
          approvalId?: string;
          scope?: ResourceScope;
        };
        const result = await executeToolCall(
          {
            tool: data.tool ?? '',
            args: data.args ?? {},
            dryRun: data.dryRun,
            scope: data.scope,
          },
          {
            allowlist: ctx.allowlist,
            approvals: ctx.approvals,
            actor: user.username,
            roles: user.roles as SystemRole[],
            scope: data.scope,
            protection: ctx.protection,
            host: ctx.host,
            audit: ctx.audit,
            dataDir: ctx.dataDir,
          },
          data.approvalId,
        );
        return sendJson(res, 200, result);
      }

      if (method === 'GET' && url.pathname === '/api/v1/tools') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: ctx.allowlist.list() });
      }

      if (method === 'POST' && url.pathname === '/api/v1/rbac/check') {
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          role?: string;
          scope?: { kind: string; id?: string };
          level?: string;
        };
        const decision = checkRbac(
          data.role as 'admin',
          (data.scope as { kind: 'global' }) ?? { kind: 'global' },
          (data.level as 'read') ?? 'read',
        );
        return sendJson(res, 200, decision);
      }

      if (method === 'POST' && url.pathname === '/api/v1/protection') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          networkReachable?: boolean;
          ddosSuspected?: boolean;
          forceOffline?: boolean;
          highRequestRate?: boolean;
        };
        const state = evaluateProtection({
          networkReachable: data.networkReachable ?? true,
          ddosSuspected: data.ddosSuspected,
          forceOffline: data.forceOffline,
          highRequestRate: data.highRequestRate,
        });
        applyProtection(ctx, state);
        ctx.audit.append({
          actor: user.username,
          action: 'protection.set',
          detail: state,
          ok: true,
        });
        return sendJson(res, 200, ctx.protection);
      }

      if (method === 'GET' && url.pathname === '/api/v1/approvals') {
        ctx.auth.authenticate(getBearer(req));
        const status = url.searchParams.get('status') as 'pending' | null;
        return sendJson(res, 200, {
          items: status ? ctx.approvals.list(status) : ctx.approvals.list(),
        });
      }

      if (
        method === 'POST' &&
        url.pathname.startsWith('/api/v1/approvals/') &&
        url.pathname.endsWith('/approve')
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const record = ctx.approvals.approve(id, user.username);
        ctx.audit.append({
          actor: user.username,
          action: 'approval.approve',
          resource: id,
          detail: record,
          ok: true,
        });
        return sendJson(res, 200, record);
      }

      if (
        method === 'POST' &&
        url.pathname.startsWith('/api/v1/approvals/') &&
        url.pathname.endsWith('/reject')
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const record = ctx.approvals.reject(id, user.username);
        return sendJson(res, 200, record);
      }

      if (method === 'POST' && url.pathname === '/api/v1/llm/chat') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          model?: string;
          messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        };
        const response = await ctx.llm.chat({
          model: data.model,
          messages: data.messages ?? [],
        });
        return sendJson(res, 200, response);
      }

      if (method === 'POST' && url.pathname === '/api/v1/settings/llm') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          baseUrl?: string;
          apiKey?: string;
          model?: string;
        };
        ctx.settings.setJson('llm', data);
        ctx.reloadLlm();
        ctx.audit.append({
          actor: user.username,
          action: 'settings.llm',
          detail: { baseUrl: data.baseUrl, model: data.model },
          ok: true,
        });
        return sendJson(res, 200, { ok: true, llm: data, transport: data.baseUrl ? 'http' : 'echo' });
      }

      if (method === 'GET' && url.pathname === '/api/v1/settings/llm') {
        ctx.auth.authenticate(getBearer(req));
        const llm = ctx.settings.getJson<{ baseUrl?: string }>('llm') ?? {};
        return sendJson(res, 200, {
          llm,
          transport: llm.baseUrl || process.env.YSK_LLM_BASE_URL ? 'http' : 'echo',
        });
      }

      if (method === 'GET' && url.pathname === '/api/v1/email/domains') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: ctx.email.list().map(redactEmail) });
      }

      if (method === 'POST' && url.pathname === '/api/v1/email/domains') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          serverIp?: string;
          serverIpv6?: string;
          mailHostname?: string;
        };
        const created = ctx.email.create({
          domain: data.domain ?? '',
          serverIp: data.serverIp ?? '',
          serverIpv6: data.serverIpv6,
          mailHostname: data.mailHostname,
          actor: user.username,
        });
        return sendJson(res, 201, created);
      }

      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/dns$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        return sendJson(res, 200, ctx.email.getDnsBundle(id));
      }

      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/checks$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dnsApplied?: boolean;
          dmarcPresent?: boolean;
          ptrOk?: boolean;
          port25Open?: boolean | null;
        };
        return sendJson(res, 200, ctx.email.updateChecks(id, data, user.username));
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/test-send$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { from?: string; to?: string; subject?: string };
        const result = await ctx.email.testSend(
          id,
          { from: data.from ?? '', to: data.to ?? '', subject: data.subject },
          user.username,
        );
        return sendJson(res, result.ok ? 200 : 422, result);
      }

      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        return sendJson(res, 200, { items: ctx.email.listMailboxes(id) });
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          localPart?: string;
          password?: string;
          provisionSystem?: boolean;
        };
        const result = await ctx.email.createMailbox(id, {
          localPart: data.localPart ?? '',
          password: data.password,
          provisionSystem: data.provisionSystem,
          actor: user.username,
        });
        return sendJson(res, result.ok ? 201 : 422, result);
      }

      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        return sendJson(res, 200, { items: ctx.email.listAliases(id) });
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          type?: 'alias' | 'forward' | 'catchall';
          localPart?: string;
          destinations?: string[];
        };
        const result = ctx.email.createAlias(id, {
          type: data.type ?? 'forward',
          localPart: data.localPart,
          destinations: data.destinations ?? [],
          actor: user.username,
        });
        return sendJson(res, 201, result);
      }
      if (
        method === 'DELETE' &&
        url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases\/[^/]+$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const parts = url.pathname.split('/');
        const id = parts[5];
        const aliasId = parts[7];
        const result = ctx.email.deleteAlias(id, aliasId, user.username);
        return sendJson(res, 200, result);
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/flags$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          catchallAddress?: string | null;
          autoreplyEnabled?: boolean;
          autoreplySubject?: string;
          autoreplyBody?: string;
          rateLimitPerHour?: number | null;
          antispam?: boolean;
          suspended?: boolean;
        };
        const domain = ctx.email.updateDomainMailFlags(id, data, user.username);
        return sendJson(res, 200, { domain: redactEmail(domain as unknown as Record<string, unknown>) });
      }

      if (
        method === 'GET' &&
        url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/autodiscover$/)
      ) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const d = ctx.email.get(id);
        const { renderMozillaAutoconfig, renderOutlookAutodiscover } = await import('@ysk/core');
        return sendJson(res, 200, {
          domain: d.domain,
          mailHostname: d.mail_hostname,
          mozillaXml: renderMozillaAutoconfig({
            domain: d.domain,
            imapHost: d.mail_hostname,
            smtpHost: d.mail_hostname,
          }),
          outlookXml: renderOutlookAutodiscover({
            domain: d.domain,
            imapHost: d.mail_hostname,
            smtpHost: d.mail_hostname,
          }),
          urls: {
            mozilla: `https://autoconfig.${d.domain}/mail/config-v1.1.xml`,
            outlook: `https://autodiscover.${d.domain}/autodiscover/autodiscover.xml`,
          },
          notes: [
            '請將下列 XML 部署到對應 hostname，或複製到外部 DNS 主機',
            `IMAP/SMTP: ${d.mail_hostname}`,
          ],
        });
      }

      if (method === 'GET' && url.pathname === '/api/v1/email/queue') {
        ctx.auth.authenticate(getBearer(req));
        const { listMailQueue } = await import('@ysk/core');
        return sendJson(res, 200, await listMailQueue(ctx.host));
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/queue/flush') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { id?: string; all?: boolean };
        const { flushMailQueue } = await import('@ysk/core');
        const r = await flushMailQueue(ctx.host, data);
        ctx.audit.append({
          actor: user.username,
          action: 'email.queue.flush',
          detail: data,
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 422, r);
      }

      if (method === 'GET' && url.pathname === '/api/v1/email/mailboxes') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: ctx.email.listMailboxes() });
      }

      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/dovecot-passdb$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const domain = ctx.email.get(id);
        const result = writeDovecotPassdb({
          dataDir: ctx.dataDir,
          db: ctx.db,
          domain: domain.domain,
          domainId: id,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.dovecot_passdb',
          resource: domain.domain,
          detail: { mailboxCount: result.mailboxCount, written: result.written },
          ok: result.ok,
        });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && url.pathname === '/api/v1/email/dovecot-passdb/all') {
        const user = ctx.auth.authenticate(getBearer(req));
        const result = writeAllDovecotPassdbs({ dataDir: ctx.dataDir, db: ctx.db });
        ctx.audit.append({
          actor: user.username,
          action: 'email.dovecot_passdb.all',
          detail: { domains: result.domains.length },
          ok: true,
        });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && url.pathname === '/api/v1/email/webmail/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          imapHost?: string;
          smtpHost?: string;
          download?: boolean;
          systemInstall?: boolean;
        };
        const result = await applyWebmail({
          dataDir: ctx.dataDir,
          host: ctx.host,
          domain: data.domain ?? 'webmail.example.com',
          imapHost: data.imapHost,
          smtpHost: data.smtpHost,
          download: data.download,
          systemInstall: data.systemInstall,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.webmail.apply',
          resource: result.domain,
          detail: { mode: result.mode, ok: result.ok },
          ok: result.ok,
        });
        return sendJson(res, result.ok || result.mode === 'plan' ? 200 : 422, result);
      }

      if (method === 'POST' && url.pathname === '/api/v1/email/bootstrap') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          serverIp?: string;
          mailHostname?: string;
          installPackages?: boolean;
          adminLocalPart?: string;
          adminPassword?: string;
          webmail?: boolean;
          relay?: {
            host: string;
            port?: number;
            username?: string;
            password?: string;
          };
        };
        const result = await bootstrapEmailServer({
          dataDir: ctx.dataDir,
          db: ctx.db,
          host: ctx.host,
          domain: data.domain ?? '',
          serverIp: data.serverIp ?? '',
          mailHostname: data.mailHostname,
          actor: user.username,
          audit: ctx.audit,
          installPackages: data.installPackages,
          adminLocalPart: data.adminLocalPart,
          adminPassword: data.adminPassword,
          webmail: data.webmail,
          relay: data.relay,
        });
        return sendJson(res, result.ok ? 200 : 422, result);
      }

      if (method === 'GET' && url.pathname === '/api/v1/hosting/runtimes') {
        ctx.auth.authenticate(getBearer(req));
        const supported = listSupportedRuntimes();
        const probe = await probeRuntimes(ctx.host);
        return sendJson(res, 200, { supported, probe });
      }

      if (method === 'POST' && url.pathname === '/api/v1/hosting/runtimes/install') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          kind?: 'node' | 'php' | 'python' | 'go' | 'rust';
          version?: string;
          install?: boolean;
        };
        const kind = data.kind ?? 'node';
        const defaultVer =
          kind === 'php'
            ? '8.2'
            : kind === 'python'
              ? '3.12'
              : kind === 'go'
                ? '1.22'
                : kind === 'rust'
                  ? 'stable'
                  : '20';
        const result = await planOrInstallRuntime({
          dataDir: ctx.dataDir,
          host: ctx.host,
          kind,
          version: data.version ?? defaultVer,
          install: data.install,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.runtime.install',
          detail: {
            kind: result.kind,
            version: result.version,
            ok: result.ok,
            install: Boolean(data.install),
          },
          ok: result.ok,
        });
        return sendJson(res, result.ok || !data.install ? 200 : 422, result);
      }

      // —— Global PHP php.ini (panel-managed) ——
      if (method === 'GET' && url.pathname === '/api/v1/hosting/php/ini') {
        ctx.auth.authenticate(getBearer(req));
        const { getPhpIni } = await import('@ysk/core');
        const version = url.searchParams.get('version') ?? '8.2';
        return sendJson(res, 200, getPhpIni(ctx.dataDir, version));
      }
      if (method === 'PUT' && url.pathname === '/api/v1/hosting/php/ini') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          version?: string;
          values?: Record<string, string | number | boolean>;
          extra?: Record<string, string>;
          rawAppend?: string;
        };
        const { savePhpIniSettings } = await import('@ysk/core');
        const result = savePhpIniSettings(ctx.dataDir, {
          version: data.version ?? '8.2',
          values: data.values ?? {},
          extra: data.extra ?? {},
          rawAppend: data.rawAppend ?? '',
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.php.ini.save',
          detail: { version: result.settings.version, written: result.written },
          ok: true,
        });
        return sendJson(res, 200, {
          ok: true,
          settings: result.settings,
          managedIniPath: result.managedIniPath,
          written: result.written,
          notes: [
            '已寫入管理檔；尚未套用到系統 conf.d',
            '請用「套用到系統」或重新部署 PHP 專案（pool php_admin_*）',
          ],
        });
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/php/ini/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { version?: string };
        const { applyPhpIniSystem } = await import('@ysk/core');
        const result = await applyPhpIniSystem({
          dataDir: ctx.dataDir,
          version: data.version ?? '8.2',
          host: ctx.host,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.php.ini.apply',
          detail: result,
          ok: result.ok,
        });
        return sendJson(res, result.ok ? 200 : 422, result);
      }

      // —— Runtime tuning (node/python/go/rust) ——
      if (
        method === 'GET' &&
        url.pathname.match(/^\/api\/v1\/hosting\/runtimes\/(node|python|go|rust)\/tuning$/)
      ) {
        ctx.auth.authenticate(getBearer(req));
        const kind = url.pathname.split('/')[5] as 'node' | 'python' | 'go' | 'rust';
        const version = url.searchParams.get('version') ?? 'default';
        const {
          loadRuntimeTuning,
          listTuningCatalog,
          tuningToEnv,
        } = await import('@ysk/core');
        const settings = loadRuntimeTuning(ctx.dataDir, kind, version);
        return sendJson(res, 200, {
          kind,
          version: settings.version,
          catalog: listTuningCatalog(kind),
          settings,
          envPreview: tuningToEnv(settings),
          notes: [
            '儲存後會於下次部署寫入 systemd Environment / 行程 env',
            'written ≠ 線上行程已重載',
          ],
        });
      }
      if (
        method === 'PUT' &&
        url.pathname.match(/^\/api\/v1\/hosting\/runtimes\/(node|python|go|rust)\/tuning$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const kind = url.pathname.split('/')[5] as 'node' | 'python' | 'go' | 'rust';
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          version?: string;
          values?: Record<string, string | number | boolean>;
          env?: Record<string, string>;
        };
        const { saveRuntimeTuning, tuningToEnv, listTuningCatalog } = await import('@ysk/core');
        const result = saveRuntimeTuning(ctx.dataDir, {
          kind,
          version: data.version ?? 'default',
          values: data.values ?? {},
          env: data.env ?? {},
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.runtime.tuning.save',
          detail: { kind, version: result.settings.version, written: result.written },
          ok: true,
        });
        return sendJson(res, 200, {
          ok: true,
          catalog: listTuningCatalog(kind),
          settings: result.settings,
          envPreview: tuningToEnv(result.settings),
          written: result.written,
          notes: ['已寫入調校檔；重新部署專案後才會進線上行程'],
        });
      }

      if (method === 'GET' && url.pathname === '/api/v1/hosting/nginx') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, {
          files: listManagedNginxConfs(ctx.dataDir),
          dataDir: ctx.dataDir,
        });
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
          ok: true,
        });
        return sendJson(res, 200, result);
      }

      // —— AI tasks (Plan → Review → Execute) ——
      if (method === 'GET' && url.pathname === '/api/v1/ai/tasks') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: ctx.ai.list() });
      }
      if (method === 'POST' && url.pathname === '/api/v1/ai/tasks') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { prompt?: string; enrich?: boolean };
        const task = await ctx.ai.create(data.prompt ?? '', user.username, data.enrich !== false);
        return sendJson(res, 201, task);
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ai\/tasks\/[^/]+\/approve$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        return sendJson(res, 200, ctx.ai.approve(id, user.username));
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ai\/tasks\/[^/]+\/execute$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const task = await ctx.ai.execute(id, user.username, user.roles as SystemRole[]);
        return sendJson(res, 200, task);
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ai\/tasks\/[^/]+\/cancel$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        return sendJson(res, 200, ctx.ai.cancel(id, user.username));
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ai\/tasks\/[^/]+\/steps\/[^/]+\/reject$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const parts = url.pathname.split('/');
        const id = parts[5];
        const stepId = parts[7];
        return sendJson(res, 200, ctx.ai.rejectStep(id, stepId, user.username));
      }
      if (method === 'GET' && url.pathname === '/api/v1/ai/playbook-runs') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, {
          items: (ctx.db.snapshot.playbook_runs ?? []).slice(0, 40),
        });
      }
      if (method === 'GET' && url.pathname === '/api/v1/ai/playbooks') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: listPlaybooks() });
      }
      if (method === 'POST' && url.pathname === '/api/v1/ai/playbooks/run') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { playbookId?: string };
        const pb = getPlaybook(data.playbookId ?? '');
        const run = startPlaybookRun(pb.id, user.username);
        // Create task from playbook steps
        const task = await ctx.ai.create(
          `playbook:${pb.id} ${pb.description}`,
          user.username,
          false,
        );
        // Replace steps with playbook tools
        task.steps = pb.steps.map((s) => {
          const ev = ctx.allowlist.evaluate(s.tool);
          return {
            id: randomUUID(),
            tool: s.tool,
            args: s.args,
            risk: ev.risk,
            requiresApproval: ev.requiresApproval,
            status: 'planned' as const,
          };
        });
        // persist replaced steps
        const tasks = ctx.db.snapshot.ai_tasks as unknown as Array<{ id: string }>;
        const idx = tasks.findIndex((t) => t.id === task.id);
        if (idx >= 0) tasks[idx] = task as never;
        ctx.db.persist();
        ctx.ai.approve(task.id, user.username);
        const executed = await ctx.ai.execute(task.id, user.username, user.roles as SystemRole[]);
        run.status = executed.status === 'completed' ? 'completed' : 'failed';
        run.results = executed.steps.map((s) => ({
          tool: s.tool,
          ok: s.status === 'executed',
          detail: s.result ?? s.error,
        }));
        ctx.db.snapshot.playbook_runs.unshift(run as never);
        ctx.db.persist();
        return sendJson(res, 200, { run, task: executed });
      }
      if (method === 'POST' && url.pathname === '/api/v1/ai/rca') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { title?: string; facts?: Record<string, unknown> };
        const info = await ctx.host.sysInfo();
        const report = buildRcaReport({
          title: data.title ?? 'RCA',
          facts: { ...(data.facts ?? {}), sys: info },
        });
        ctx.audit.append({
          actor: user.username,
          action: 'ai.rca',
          detail: report,
          ok: true,
        });
        return sendJson(res, 200, report);
      }

      // —— Metrics / updates / fleet / hosting helpers ——
      if (method === 'GET' && url.pathname === '/api/v1/metrics') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, collectMetrics());
      }
      if (method === 'GET' && url.pathname === '/api/v1/updates/inventory') {
        ctx.auth.authenticate(getBearer(req));
        const cached = url.searchParams.get('cached') === '1';
        if (cached) {
          const last = ctx.settings.getJson<Record<string, unknown>>('last_inventory');
          return sendJson(res, 200, {
            cached: true,
            last,
            inventory: (last?.items as unknown[]) ?? last?.sample ?? [],
            advice: [],
          });
        }
        const inv = await collectInventory(ctx.host);
        const advice = adviseInventory(inv);
        ctx.settings.setJson('last_inventory', {
          at: new Date().toISOString(),
          count: inv.length,
          sample: inv.slice(0, 40),
          items: inv.slice(0, 80),
        });
        return sendJson(res, 200, {
          cached: false,
          inventory: inv,
          advice,
          collectedAt: new Date().toISOString(),
        });
      }
      if (method === 'POST' && url.pathname === '/api/v1/updates/inventory/refresh') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { osv?: boolean; limit?: number };
        const inv = await collectInventory(ctx.host);
        let advice = adviseInventory(inv);
        if (data.osv) {
          const limit = Math.min(data.limit ?? 5, 15);
          for (const item of advice.slice(0, limit)) {
            const cves = await lookupOsvVulns(item.packageName, item.currentVersion);
            if (cves.length) {
              item.cves = cves;
              item.summary = `${item.summary}; OSV: ${cves.slice(0, 3).join(', ')}`;
            }
          }
        }
        ctx.settings.setJson('last_inventory', {
          at: new Date().toISOString(),
          count: inv.length,
          sample: inv.slice(0, 40),
          items: inv.slice(0, 80),
          advice: advice.slice(0, 40),
        });
        ctx.audit.append({
          actor: user.username,
          action: 'update.inventory.refresh',
          detail: { count: inv.length, osv: Boolean(data.osv) },
          ok: true,
        });
        return sendJson(res, 200, {
          inventory: inv,
          advice,
          collectedAt: new Date().toISOString(),
        });
      }
      if (method === 'GET' && url.pathname === '/api/v1/updates/self') {
        ctx.auth.authenticate(getBearer(req));
        const latest = process.env.YSK_LATEST_VERSION ?? VERSION;
        return sendJson(res, 200, planSelfUpdate({ current: VERSION, latest }));
      }
      if (method === 'POST' && url.pathname === '/api/v1/updates/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          packageName?: string;
          currentVersion?: string;
          candidateVersion?: string;
          risk?: string;
          advice?: string;
          requiresApproval?: boolean;
          cves?: string[];
          summary?: string;
          confirmHighRisk?: boolean;
        };
        const { applyPackageUpdate, planUpdateExecution, adviseUpdate } = await import('@ysk/core');
        const item = adviseUpdate({
          packageName: data.packageName ?? '',
          currentVersion: data.currentVersion ?? '0',
          candidateVersion: data.candidateVersion ?? data.currentVersion,
          knownCves: data.cves,
          hasSecurityFix: Boolean(data.cves?.length),
        });
        // Preserve client risk signals when present
        if (data.risk) (item as { risk: string }).risk = data.risk;
        if (data.requiresApproval != null) item.requiresApproval = data.requiresApproval;
        if (data.summary) item.summary = data.summary;
        const plan = planUpdateExecution(item);
        const result = await applyPackageUpdate({
          host: ctx.host,
          item,
          confirmHighRisk: data.confirmHighRisk,
        });
        ctx.db.snapshot.update_jobs.unshift({
          id: randomUUID(),
          packageName: item.packageName,
          at: new Date().toISOString(),
          actor: user.username,
          ok: result.ok,
          applied: result.applied,
          notes: result.notes,
          plan,
        } as never);
        ctx.db.persist();
        ctx.audit.append({
          actor: user.username,
          action: 'update.package.apply',
          resource: item.packageName,
          detail: result,
          ok: result.ok,
        });
        return sendJson(res, result.ok ? 200 : result.blocked ? 422 : 500, result);
      }
      if (method === 'GET' && url.pathname === '/api/v1/backups') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, {
          items: listBackups(ctx.dataDir),
          lastRun: ctx.settings.getJson('last_backup_run') ?? null,
        });
      }
      if (method === 'POST' && url.pathname === '/api/v1/backups/run-all') {
        const user = ctx.auth.authenticate(getBearer(req));
        const projects = ctx.db.snapshot.projects;
        const { getBackupExclusions, pushBackupRemote, resticBackupProject, getResticSettings } =
          await import('@ysk/core');
        const excludes = getBackupExclusions(ctx.db);
        const r = await backupAllProjects({
          host: ctx.host,
          dataDir: ctx.dataDir,
          projects: projects.map((p) => ({
            id: p.id,
            home_dir: p.home_dir,
            name: p.name,
          })),
          excludes: excludes.length
            ? excludes
            : ['node_modules', '.git', 'vendor', '.cache'],
        });
        const sideNotes: string[] = [];
        const sideResults: Array<{
          projectId: string;
          kind: 'remote' | 'restic';
          ok: boolean;
          skipped?: boolean;
          notes: string[];
        }> = [];
        let sideOk = true;
        const resticOn = getResticSettings(ctx.db).enabled;
        for (const item of r.results) {
          if (item.ok && item.archivePath && !item.skipped) {
            const p = projects.find((x) => x.id === item.projectId);
            if (p) {
              p.last_backup_path = item.archivePath;
              p.last_backup_at = new Date().toISOString();
              p.updated_at = new Date().toISOString();
            }
            try {
              const push = await pushBackupRemote({
                host: ctx.host,
                db: ctx.db,
                localArchivePath: item.archivePath,
              });
              sideResults.push({
                projectId: item.projectId,
                kind: 'remote',
                ok: push.ok,
                skipped: push.skipped,
                notes: push.notes,
              });
              sideNotes.push(
                ...push.notes.map((n) => `[remote ${item.projectId.slice(0, 8)}] ${n}`),
              );
              if (!push.skipped && !push.ok) sideOk = false;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              sideOk = false;
              sideResults.push({
                projectId: item.projectId,
                kind: 'remote',
                ok: false,
                notes: [msg],
              });
              sideNotes.push(`[remote ${item.projectId.slice(0, 8)}] ${msg}`);
            }
            if (resticOn && p) {
              try {
                const rs = await resticBackupProject({
                  host: ctx.host,
                  dataDir: ctx.dataDir,
                  db: ctx.db,
                  projectId: p.id,
                  homeDir: p.home_dir,
                });
                sideResults.push({
                  projectId: item.projectId,
                  kind: 'restic',
                  ok: rs.ok,
                  skipped: rs.skipped,
                  notes: rs.notes,
                });
                sideNotes.push(
                  ...rs.notes.map((n) => `[restic ${item.projectId.slice(0, 8)}] ${n}`),
                );
                if (!rs.skipped && !rs.ok) sideOk = false;
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                sideOk = false;
                sideResults.push({
                  projectId: item.projectId,
                  kind: 'restic',
                  ok: false,
                  notes: [msg],
                });
                sideNotes.push(`[restic ${item.projectId.slice(0, 8)}] ${msg}`);
              }
            }
          }
        }
        ctx.db.persist();
        const overallOk = r.ok && sideOk;
        const payload = {
          at: new Date().toISOString(),
          ...r,
          ok: overallOk,
          tarOk: r.ok,
          sideOk,
          sideResults,
          notes: [
            ...r.notes,
            ...sideNotes.slice(0, 40),
            !sideOk
              ? '遠端推送或 restic 有失敗 — 本地 tar 可能已成功，請看 sideResults'
              : resticOn
                ? '遠端／restic 步驟已處理'
                : 'restic 未啟用（僅 tar）',
          ],
        };
        ctx.settings.setJson('last_backup_run', payload);
        ctx.audit.append({
          actor: user.username,
          action: 'backup.run_all',
          detail: {
            ok: overallOk,
            tarOk: r.ok,
            sideOk,
            projectCount: projects.length,
            resultCount: r.results.length,
          },
          ok: overallOk,
        });
        return sendJson(res, overallOk ? 200 : 422, payload);
      }

      if (method === 'GET' && url.pathname === '/api/v1/backups/settings') {
        ctx.auth.authenticate(getBearer(req));
        const {
          getBackupRemotePublic,
          getBackupExclusions,
          getResticSettingsPublic,
        } = await import('@ysk/core');
        return sendJson(res, 200, {
          remote: getBackupRemotePublic(ctx.db),
          exclusions: getBackupExclusions(ctx.db),
          restic: getResticSettingsPublic(ctx.db),
        });
      }
      if (method === 'POST' && url.pathname === '/api/v1/backups/settings') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          remote?: Record<string, unknown>;
          exclusions?: string[];
          restic?: Record<string, unknown>;
        };
        const {
          setBackupRemote,
          setBackupExclusions,
          getBackupRemotePublic,
          getBackupExclusions,
          setResticSettings,
          getResticSettingsPublic,
        } = await import('@ysk/core');
        if (data.remote) setBackupRemote(ctx.db, data.remote as never);
        if (data.exclusions) setBackupExclusions(ctx.db, data.exclusions);
        if (data.restic) setResticSettings(ctx.db, data.restic as never);
        ctx.audit.append({
          actor: user.username,
          action: 'backup.settings',
          detail: {
            hasRemote: Boolean(data.remote),
            exclusions: data.exclusions?.length,
            restic: Boolean(data.restic),
          },
          ok: true,
        });
        return sendJson(res, 200, {
          ok: true,
          remote: getBackupRemotePublic(ctx.db),
          exclusions: getBackupExclusions(ctx.db),
          restic: getResticSettingsPublic(ctx.db),
        });
      }
      if (method === 'POST' && url.pathname === '/api/v1/backups/restic/run') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { resticBackupProject, getResticSettings } = await import('@ysk/core');
        const rs = getResticSettings(ctx.db);
        if (!rs.enabled) {
          return sendJson(res, 422, {
            ok: false,
            notes: ['restic 未啟用 — 請先在「遠端／排除」開啟並設定 password'],
            results: [],
          });
        }
        if (!rs.password?.trim()) {
          return sendJson(res, 422, {
            ok: false,
            notes: ['restic 已啟用但未設定 password'],
            results: [],
          });
        }
        const projects = ctx.db.snapshot.projects.slice(0, 40);
        if (projects.length === 0) {
          return sendJson(res, 200, {
            ok: true,
            empty: true,
            notes: ['沒有專案可做 restic 增量'],
            results: [],
          });
        }
        const results = [];
        for (const p of projects) {
          results.push({
            projectId: p.id,
            ...(await resticBackupProject({
              host: ctx.host,
              dataDir: ctx.dataDir,
              db: ctx.db,
              projectId: p.id,
              homeDir: p.home_dir,
            })),
          });
        }
        const attempted = results.filter((row) => !row.skipped);
        const ok =
          attempted.length === 0 ? true : attempted.every((row) => row.ok);
        ctx.audit.append({
          actor: user.username,
          action: 'backup.restic.run',
          detail: { count: results.length, ok },
          ok,
        });
        return sendJson(res, ok ? 200 : 422, {
          ok,
          results,
          notes: [
            `restic ${attempted.filter((x) => x.ok).length}/${attempted.length} 成功`,
            ok ? '完成' : '有失敗 — 請查看 results',
          ],
        });
      }
      if (method === 'GET' && url.pathname === '/api/v1/backups/restic/snapshots') {
        ctx.auth.authenticate(getBearer(req));
        const projectId = url.searchParams.get('projectId') ?? undefined;
        const { listResticSnapshots } = await import('@ysk/core');
        const r = await listResticSnapshots({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir,
          projectId,
        });
        return sendJson(res, r.ok ? 200 : 422, r);
      }
      if (method === 'POST' && url.pathname === '/api/v1/backups/restic/restore') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          projectId?: string;
          snapshotId?: string;
          targetDir?: string;
          overwriteHome?: boolean;
          confirmPhrase?: string;
          dryRun?: boolean;
        };
        const p = ctx.db.snapshot.projects.find((x) => x.id === data.projectId);
        if (!p) return sendJson(res, 404, { ok: false, notes: ['專案不存在'] });
        const { resticRestoreProject } = await import('@ysk/core');
        const r = await resticRestoreProject({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir,
          projectId: p.id,
          homeDir: p.home_dir,
          snapshotId: data.snapshotId ?? '',
          targetDir: data.targetDir,
          overwriteHome: data.overwriteHome,
          confirmPhrase: data.confirmPhrase,
          dryRun: data.dryRun,
        });
        ctx.audit.append({
          actor: user.username,
          action: data.dryRun ? 'backup.restic.restore.dry_run' : 'backup.restic.restore',
          resource: p.id,
          detail: {
            ok: r.ok,
            dryRun: Boolean(data.dryRun),
            overwriteHome: Boolean(data.overwriteHome),
            notes: r.notes,
          },
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 422, r);
      }
      if (method === 'POST' && url.pathname === '/api/v1/backups/restore') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          projectId?: string;
          name?: string;
          mode?: 'full' | 'web' | 'dry-run';
        };
        if (!data.projectId || !data.name) {
          return sendJson(res, 400, { ok: false, notes: ['projectId 與 name 必填'] });
        }
        const project = ctx.db.snapshot.projects.find((p) => p.id === data.projectId);
        if (!project) {
          return sendJson(res, 404, { ok: false, notes: ['找不到專案'] });
        }
        const r = await restoreProjectBackup({
          host: ctx.host,
          dataDir: ctx.dataDir,
          projectId: data.projectId,
          archiveName: data.name,
          homeDir: project.home_dir,
          linuxUser: project.linux_user,
          linuxGroup: project.linux_group || project.linux_user,
          mode: data.mode,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'backup.restore',
          resource: data.projectId,
          detail: { name: data.name, mode: data.mode ?? 'full', ...r },
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 422, r);
      }
      if (method === 'DELETE' && url.pathname === '/api/v1/backups') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { projectId?: string; name?: string };
        if (!data.projectId || !data.name) {
          return sendJson(res, 400, { ok: false, notes: ['projectId 與 name 必填'] });
        }
        const r = deleteProjectBackup(ctx.dataDir, data.projectId, data.name);
        ctx.audit.append({
          actor: user.username,
          action: 'backup.delete',
          resource: data.projectId,
          detail: { name: data.name, ...r },
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 422, r);
      }
      if (method === 'GET' && url.pathname === '/api/v1/backups/download') {
        ctx.auth.authenticate(getBearer(req));
        const projectId = url.searchParams.get('projectId') ?? '';
        const name = url.searchParams.get('name') ?? '';
        const r = resolveBackupDownloadPath(ctx.dataDir, projectId, name);
        if (!r.ok) return sendJson(res, 404, r);
        const { createReadStream, statSync } = await import('node:fs');
        const st = statSync(r.path);
        res.writeHead(200, {
          'Content-Type': 'application/gzip',
          'Content-Length': st.size,
          'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
        });
        createReadStream(r.path).pipe(res);
        return;
      }
      if (method === 'POST' && url.pathname === '/api/v1/backups/schedule') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { schedule?: string };
        const job = ctx.cron.ensureBackupSchedule(data.schedule ?? '0 3 * * *');
        ctx.audit.append({
          actor: user.username,
          action: 'backup.schedule',
          detail: job,
          ok: true,
        });
        return sendJson(res, 200, {
          ok: true,
          job,
          notes: [
            `已確保排程：${job.schedule} ${job.command}`,
            '仍需到 Cron 頁「安裝到系統 crontab」才會真正生效',
          ],
        });
      }
      if (method === 'GET' && url.pathname === '/api/v1/scheduler') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { jobs: ctx.scheduler.list() });
      }

      // SSL upload (PEM) + list managed cert files
      if (method === 'POST' && url.pathname === '/api/v1/ssl/upload') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          fullchainPem?: string;
          privkeyPem?: string;
        };
        const cert = uploadCertificate({
          db: ctx.db,
          dataDir: ctx.dataDir,
          domain: data.domain ?? '',
          fullchainPem: data.fullchainPem ?? '',
          privkeyPem: data.privkeyPem ?? '',
          actor: user.username,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'ssl.upload',
          resource: cert.domain,
          detail: { id: cert.id, paths: [cert.fullchain_path, cert.privkey_path] },
          ok: true,
        });
        return sendJson(res, 201, { certificate: cert });
      }
      if (method === 'GET' && url.pathname === '/api/v1/ssl/uploaded') {
        ctx.auth.authenticate(getBearer(req));
        const { listCertificatesView, dedupeCertificatesInStore } = await import('@ysk/core');
        dedupeCertificatesInStore(ctx.db);
        return sendJson(res, 200, {
          files: listUploadedCertFiles(ctx.dataDir),
          certificates: listCertificatesView(ctx.db, ctx.dataDir),
          items: listCertificatesView(ctx.db, ctx.dataDir),
        });
      }
      if (method === 'GET' && url.pathname === '/api/v1/ssl/certificates') {
        ctx.auth.authenticate(getBearer(req));
        const { listCertificatesView, dedupeCertificatesInStore } = await import('@ysk/core');
        dedupeCertificatesInStore(ctx.db);
        return sendJson(res, 200, { items: listCertificatesView(ctx.db, ctx.dataDir) });
      }
      if (method === 'GET' && url.pathname === '/api/v1/ssl/bindings') {
        ctx.auth.authenticate(getBearer(req));
        const { listCertificatesView, dedupeCertificatesInStore } = await import('@ysk/core');
        dedupeCertificatesInStore(ctx.db);
        const certs = listCertificatesView(ctx.db, ctx.dataDir);
        const projects = ctx.projects.list();
        const mail = ctx.email.list();
        const bindings = certs.map((c) => {
          const domain = String((c as { domain?: string }).domain ?? '');
          const linkedProjects = projects
            .filter(
              (p) =>
                p.domain === domain ||
                (p.domainAliases ?? []).includes(domain) ||
                (domain && p.domain?.endsWith(domain)),
            )
            .map((p) => ({ id: p.id, name: p.name, domain: p.domain }));
          const linkedMail = mail
            .filter((m) => m.domain === domain || domain.endsWith(m.domain))
            .map((m) => ({ id: m.id, domain: m.domain }));
          return {
            ...c,
            projects: linkedProjects,
            mailDomains: linkedMail,
          };
        });
        // renew job probe
        const cronJobs = ctx.cron.list().filter(
          (j) =>
            j.command.includes('certbot') ||
            j.command.includes('letsencrypt') ||
            j.command.includes('ssl'),
        );
        return sendJson(res, 200, {
          items: bindings,
          renewJobs: cronJobs,
          notes: [
            cronJobs.length
              ? `找到 ${cronJobs.length} 個可能相關嘅續期 cron`
              : '未登記 certbot/LE 續期 cron（可用系統 certbot.timer）',
          ],
        });
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/ssl\/certificates\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const idOrDomain = decodeURIComponent(url.pathname.split('/').pop() ?? '');
        const { deleteCertificate } = await import('@ysk/core');
        const r = deleteCertificate(ctx.db, ctx.dataDir, idOrDomain);
        ctx.audit.append({
          actor: user.username,
          action: 'ssl.delete',
          resource: r.domain,
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 404, r);
      }

      // FTPS apply handled by handleSystemRoutes (settings/status/apply)
      if (method === 'GET' && url.pathname === '/api/v1/fleet/agents') {
        ctx.auth.authenticate(getBearer(req));
        const group = url.searchParams.get('group') ?? undefined;
        return sendJson(res, 200, { items: ctx.fleet.list(group) });
      }
      if (method === 'POST' && url.pathname === '/api/v1/fleet/agents/register') {
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          agentId?: string;
          group?: string;
          meta?: Record<string, unknown>;
        };
        const session = ctx.fleet.register(data.agentId ?? '', data.group, data.meta);
        return sendJson(res, 200, session);
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/fleet\/agents\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const r = ctx.fleet.remove(id);
        ctx.audit.append({
          actor: user.username,
          action: 'fleet.remove',
          resource: id,
          detail: r,
          ok: true,
        });
        return sendJson(res, 200, r);
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/fleet\/agents\/[^/]+\/heartbeat$/)) {
        const id = url.pathname.split('/')[5];
        return sendJson(res, 200, ctx.fleet.heartbeat(id));
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/fleet\/agents\/[^/]+\/commands$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { payload?: unknown };
        const cmd = ctx.fleet.enqueue(id, data.payload ?? {});
        ctx.audit.append({
          actor: user.username,
          action: 'fleet.command',
          resource: id,
          detail: cmd,
          ok: true,
        });
        return sendJson(res, 200, cmd);
      }
      // Edge pull: only queued. Panel history: ?history=1
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/fleet\/agents\/[^/]+\/commands$/)) {
        const id = url.pathname.split('/')[5];
        const history = url.searchParams.get('history') === '1';
        if (history) {
          ctx.auth.authenticate(getBearer(req));
          return sendJson(res, 200, { items: ctx.fleet.listCommands(id) });
        }
        return sendJson(res, 200, { items: ctx.fleet.pullCommands(id) });
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/fleet\/commands\/[^/]+\/ack$/)) {
        const cmdId = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { result?: unknown; error?: boolean };
        const cmd = ctx.fleet.ack(cmdId, data.result, Boolean(data.error));
        if (!cmd) {
          return sendJson(res, 404, { error: 'command not found' });
        }
        return sendJson(res, 200, cmd);
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/live-check$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const d = ctx.email.get(id);
        const live = await runLiveEmailChecks({
          domain: d.domain,
          serverIp: d.server_ip,
          mailHostname: d.mail_hostname,
          dkimPublicKey: d.dkim_public_key,
          dkimSelector: d.dkim_selector,
        });
        return sendJson(res, 200, live);
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/webmail/sso') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          email?: string;
          domain?: string;
          ttlMinutes?: number;
          password?: string;
        };
        const { issueWebmailSso } = await import('@ysk/core');
        const r = issueWebmailSso({
          db: ctx.db,
          email: data.email ?? '',
          domain: data.domain ?? '',
          ttlMinutes: data.ttlMinutes,
          password: data.password,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.webmail.sso',
          resource: data.email,
          detail: { ok: r.ok, expiresAt: r.expiresAt, hasPassword: Boolean(data.password) },
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 400, r);
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/webmail/sso/consume') {
        // Used by webmail edge / test — token in body
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { token?: string };
        const { consumeWebmailSso } = await import('@ysk/core');
        const r = consumeWebmailSso(ctx.db, data.token ?? '');
        return sendJson(res, r.ok ? 200 : 401, r);
      }
      if (method === 'GET' && url.pathname === '/api/v1/email/sieve') {
        ctx.auth.authenticate(getBearer(req));
        const mailbox = url.searchParams.get('mailbox') ?? '';
        const { listSieveScripts } = await import('@ysk/core');
        return sendJson(res, 200, { items: listSieveScripts(ctx.dataDir, mailbox) });
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/sieve') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          mailbox?: string;
          name?: string;
          content?: string;
        };
        const { writeSieveScript } = await import('@ysk/core');
        const r = writeSieveScript({
          dataDir: ctx.dataDir,
          mailbox: data.mailbox ?? '',
          name: data.name,
          content: data.content ?? '',
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.sieve.write',
          resource: data.mailbox,
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, 200, r);
      }
      if (method === 'DELETE' && url.pathname === '/api/v1/email/sieve') {
        const user = ctx.auth.authenticate(getBearer(req));
        const mailbox = url.searchParams.get('mailbox') ?? '';
        const name = url.searchParams.get('name') ?? '';
        const { deleteSieveScript } = await import('@ysk/core');
        const r = deleteSieveScript(ctx.dataDir, mailbox, name);
        ctx.audit.append({
          actor: user.username,
          action: 'email.sieve.delete',
          resource: mailbox,
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 404, r);
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/dnsbl/multi') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { ips?: string[] };
        const { checkMultipleIpsDnsbl } = await import('@ysk/core');
        const r = await checkMultipleIpsDnsbl(data.ips ?? []);
        return sendJson(res, 200, r);
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
        return sendJson(res, r.ok ? 200 : 422, r);
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/policy$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          rateLimitPerHour?: number | null;
          antispam?: boolean;
          applySystem?: boolean;
        };
        const domain = ctx.email.get(id);
        ctx.email.updateDomainMailFlags(
          id,
          {
            rateLimitPerHour: data.rateLimitPerHour,
            antispam: data.antispam,
          },
          user.username,
        );
        const { applyMailDomainPolicy } = await import('@ysk/core');
        const r = await applyMailDomainPolicy({
          dataDir: ctx.dataDir,
          host: ctx.host,
          domain: domain.domain,
          rateLimitPerHour: data.rateLimitPerHour,
          antispam: data.antispam,
          applySystem: data.applySystem,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.domain.policy',
          resource: id,
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 422, r);
      }

      if (method === 'POST' && url.pathname === '/api/v1/email/webmail/sso-plugin') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          panelBaseUrl?: string;
          enableSystem?: boolean;
          roundcubePluginsDir?: string;
        };
        const panelBase =
          data.panelBaseUrl || `http://127.0.0.1:${process.env.YSK_PORT || process.env.PORT || 9287}`;
        if (data.enableSystem) {
          const { enableRoundcubeSsoPlugin } = await import('@ysk/core');
          const r = await enableRoundcubeSsoPlugin({
            dataDir: ctx.dataDir,
            host: ctx.host,
            panelBaseUrl: panelBase,
            roundcubePluginsDir: data.roundcubePluginsDir,
          });
          ctx.audit.append({
            actor: user.username,
            action: 'email.webmail.sso_plugin.enable',
            detail: r,
            ok: r.ok,
          });
          return sendJson(res, r.ok ? 200 : 422, r);
        }
        const { writeRoundcubeSsoPlugin } = await import('@ysk/core');
        const r = writeRoundcubeSsoPlugin({
          dataDir: ctx.dataDir,
          panelBaseUrl: panelBase,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.webmail.sso_plugin',
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 422, r);
      }

      if (method === 'GET' && url.pathname === '/api/v1/dns/external-checklist') {
        ctx.auth.authenticate(getBearer(req));
        const domain = (url.searchParams.get('domain') ?? '').trim().toLowerCase();
        const scope = (url.searchParams.get('scope') ?? 'full') as 'mail' | 'web' | 'full';
        if (!domain) {
          return sendJson(res, 400, { ok: false, message: 'domain 必填' });
        }
        const { buildExternalTodos } = await import('@ysk/core');
        const mailHostname =
          ctx.email.list().find((d) => d.domain === domain)?.mail_hostname || `mail.${domain}`;
        const items = buildExternalTodos({
          domain,
          mailHostname,
          scope: scope === 'web' || scope === 'mail' ? scope : 'full',
        });
        return sendJson(res, 200, {
          domain,
          scope,
          items,
          notes: ['此清單為站外待辦（DNS 供應商／IP 擁有者）；控制面無法代勞 PTR／解封 25'],
        });
      }

      if (method === 'GET' && url.pathname === '/api/v1/dns/cluster/peers') {
        ctx.auth.authenticate(getBearer(req));
        const { listDnsClusterPeers } = await import('@ysk/core');
        return sendJson(res, 200, { items: listDnsClusterPeers(ctx.db) });
      }
      if (method === 'POST' && url.pathname === '/api/v1/dns/cluster/peers') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          host?: string;
          username?: string;
          port?: number;
          path?: string;
          label?: string;
          id?: string;
        };
        const { upsertDnsClusterPeer } = await import('@ysk/core');
        const peer = upsertDnsClusterPeer(ctx.db, {
          id: data.id,
          host: data.host ?? '',
          username: data.username ?? '',
          port: data.port,
          path: data.path,
          label: data.label,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'dns.cluster.peer',
          resource: peer.id,
          detail: { host: peer.host },
          ok: true,
        });
        return sendJson(res, 200, { peer });
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/dns\/cluster\/peers\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[6];
        const { deleteDnsClusterPeer } = await import('@ysk/core');
        const ok = deleteDnsClusterPeer(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'dns.cluster.peer.delete',
          resource: id,
          detail: { ok },
          ok,
        });
        return sendJson(res, ok ? 200 : 404, { ok });
      }
      if (method === 'POST' && url.pathname === '/api/v1/dns/cluster/push') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { peerId?: string };
        const { pushDnsZonesToCluster } = await import('@ysk/core');
        const r = await pushDnsZonesToCluster({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          peerId: data.peerId,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'dns.cluster.push',
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 422, r);
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
          linuxUser: proj.linuxUser,
        });
        const daily = recordProjectDailyStats(ctx.dataDir, id, stats);
        return sendJson(res, 200, {
          ...stats,
          daily: daily.series,
          history: readProjectDailyStats(ctx.dataDir, id),
        });
      }

      if (method === 'GET' && url.pathname === '/api/v1/db/temp-users') {
        ctx.auth.authenticate(getBearer(req));
        const { listTempDbUsers } = await import('@ysk/core');
        return sendJson(res, 200, { items: listTempDbUsers(ctx.db) });
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
        return sendJson(res, r.ok ? 201 : 422, r);
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/db\/temp-users\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { revokeTempDbUser } = await import('@ysk/core');
        const r = revokeTempDbUser(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'db.temp_user.revoke',
          resource: id,
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 404, r);
      }
      if (method === 'GET' && url.pathname === '/api/v1/db/remote-hosts') {
        ctx.auth.authenticate(getBearer(req));
        const { listRemoteDbHosts } = await import('@ysk/core');
        return sendJson(res, 200, { items: listRemoteDbHosts(ctx.db) });
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
        return sendJson(res, 200, { host: row });
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/db\/remote-hosts\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { deleteRemoteDbHost } = await import('@ysk/core');
        const ok = deleteRemoteDbHost(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'db.remote_host.delete',
          resource: id,
          detail: { ok },
          ok,
        });
        return sendJson(res, ok ? 200 : 404, { ok });
      }

      if (method === 'POST' && url.pathname === '/api/v1/email/dnsbl/check') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { ip?: string };
        const ip = data.ip?.trim();
        if (!ip) {
          return sendJson(res, 400, {
            ok: false,
            code: 'YSK_VALIDATION',
            message: '請指定 IP',
          });
        }
        const report = await checkIpDnsbl(ip);
        return sendJson(res, 200, report);
      }
      if (method === 'GET' && url.pathname === '/api/v1/email/dnsbl/last') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, {
          last: ctx.settings.getJson('last_dnsbl_run') ?? null,
        });
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/warmup') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          serverIp?: string;
          isNewIp?: boolean;
        };
        const plan = planEmailWarmup({
          domain: data.domain ?? 'example.com',
          serverIp: data.serverIp ?? '203.0.113.10',
          isNewIp: data.isNewIp,
        });
        return sendJson(res, 200, plan);
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/warmup$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const d = ctx.email.get(id);
        const plan = planEmailWarmup({
          domain: d.domain,
          serverIp: d.server_ip,
          isNewIp: true,
        });
        return sendJson(res, 200, plan);
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
          nodeBinary: process.execPath,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'project.node_apply',
          resource: id,
          detail: result,
          ok: true,
        });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/probe') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { host?: string; port?: number };
        const r = await probeEndpoint(data.host ?? '127.0.0.1', data.port ?? 3306);
        return sendJson(res, 200, r);
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/mysql-plan') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dbName?: string;
          username?: string;
          password?: string;
        };
        return sendJson(
          res,
          200,
          renderMysqlProvisionSql({
            dbName: data.dbName ?? 'app',
            username: data.username ?? 'appuser',
            password: data.password,
          }),
        );
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/plan') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          zone?: string;
          serverIp?: string;
          serverIpv6?: string;
        };
        return sendJson(
          res,
          200,
          planDnsZone({
            zone: data.zone ?? 'example.com',
            serverIp: data.serverIp ?? '1.2.3.4',
            serverIpv6: data.serverIpv6,
          }),
        );
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/zone-file') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          zone?: string;
          serverIp?: string;
          serverIpv6?: string;
          mailHost?: string;
          validate?: boolean;
        };
        const result = await writeManagedDnsZone({
          dataDir: ctx.dataDir,
          zone: data.zone ?? 'example.com',
          serverIp: data.serverIp ?? '203.0.113.10',
          serverIpv6: data.serverIpv6,
          mailHost: data.mailHost,
          host: ctx.host,
          validate: data.validate,
        });
        ctx.db.snapshot.dns_zones = [
          {
            id: randomUUID(),
            zone: result.zone,
            provider: 'bind-file',
            zonePath: result.zonePath,
            serial: result.serial,
            records: result.records,
            ok: result.ok,
            updated_at: new Date().toISOString(),
            actor: user.username,
          },
          ...ctx.db.snapshot.dns_zones.filter(
            (z) => !(String(z.zone) === result.zone && z.provider === 'bind-file'),
          ),
        ].slice(0, 50);
        ctx.db.persist();
        ctx.audit.append({
          actor: user.username,
          action: 'dns.zone_file.write',
          resource: result.zone,
          detail: { zonePath: result.zonePath, serial: result.serial, ok: result.ok },
          ok: result.ok,
        });
        return sendJson(res, result.ok ? 200 : 422, result);
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/dns/zone-files') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: listManagedDnsZones(ctx.dataDir) });
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/dns/powerdns/status') {
        ctx.auth.authenticate(getBearer(req));
        const status = await powerDnsStatus({ dataDir: ctx.dataDir, host: ctx.host });
        return sendJson(res, 200, status);
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/powerdns/install') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { install?: boolean };
        const result = await installPowerDnsPackages({
          dataDir: ctx.dataDir,
          host: ctx.host,
          install: data.install,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'dns.powerdns.install',
          detail: { ok: result.ok, install: Boolean(data.install) },
          ok: result.ok,
        });
        return sendJson(res, result.ok || !data.install ? 200 : 422, result);
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/powerdns/load') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          zone?: string;
          serverIp?: string;
          mailHost?: string;
          load?: boolean;
        };
        const result = await applyPowerDnsZone({
          dataDir: ctx.dataDir,
          host: ctx.host,
          zone: data.zone ?? 'example.com',
          serverIp: data.serverIp ?? '203.0.113.10',
          mailHost: data.mailHost,
          load: data.load,
        });
        ctx.db.snapshot.dns_zones = [
          {
            id: randomUUID(),
            zone: result.zone,
            provider: 'powerdns',
            zonePath: result.zonePath,
            mode: result.mode,
            ok: result.ok,
            updated_at: new Date().toISOString(),
            actor: user.username,
          },
          ...ctx.db.snapshot.dns_zones.filter(
            (z) => !(String(z.zone) === result.zone && z.provider === 'powerdns'),
          ),
        ].slice(0, 50);
        ctx.db.persist();
        ctx.audit.append({
          actor: user.username,
          action: 'dns.powerdns.load',
          resource: result.zone,
          detail: { mode: result.mode, ok: result.ok, zonePath: result.zonePath },
          ok: result.ok,
        });
        return sendJson(res, result.ok ? 200 : 422, result);
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/cloudflare/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          zone?: string;
          serverIp?: string;
          serverIpv6?: string;
          mailHost?: string;
          token?: string;
          dryRun?: boolean;
        };
        const result = await applyCloudflareDns({
          zone: data.zone ?? 'example.com',
          serverIp: data.serverIp ?? '203.0.113.10',
          serverIpv6: data.serverIpv6,
          mailHost: data.mailHost,
          token: data.token,
          dryRun: data.dryRun,
        });
        persistDnsZoneApply(ctx.db, result, user.username);
        ctx.audit.append({
          actor: user.username,
          action: 'dns.cloudflare.apply',
          resource: result.zoneName,
          detail: {
            ok: result.ok,
            dryRun: result.dryRun,
            created: result.created.length,
            errors: result.errors,
          },
          ok: result.ok,
        });
        return sendJson(res, result.ok || result.dryRun ? 200 : 422, result);
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/dns/zones') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: ctx.db.snapshot.dns_zones });
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/firewall/plan') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { allowSmtp?: boolean };
        return sendJson(res, 200, planFirewall({ allowSmtp: data.allowSmtp }));
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/files/plan') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, planPublicFileServer({}));
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
          detail: { ok: result.ok, nginxPath: result.nginxPath, publicRoot: result.publicRoot },
          ok: result.ok,
        });
        return sendJson(res, 200, result);
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
        return sendJson(res, result.ok ? 200 : 422, result);
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
        return sendJson(res, result.ok ? 200 : 422, result);
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
            dbHost: data.dbHost,
          });
          ctx.audit.append({
            actor: user.username,
            action: 'project.wordpress_setup',
            resource: id,
            detail: { ...result, dbPassword: undefined },
            ok: result.ok,
          });
          return sendJson(res, result.ok ? 200 : 422, result);
        }
        const result = await downloadWordpressCore({
          host: ctx.host,
          homeDir: proj.homeDir,
          force: data.force,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'project.wordpress_download',
          resource: id,
          detail: result,
          ok: result.ok,
        });
        return sendJson(res, result.ok ? 200 : 422, result);
      }

      // MySQL real provision (refuse unless EXECUTE; never fake success)
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
        return sendJson(res, result.ok ? 200 : 422, result);
      }

      // Project live status from system truth
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/status$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const status = await ctx.projectOps.liveStatus(id);
        return sendJson(res, 200, status);
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
          skipBuild: data.skipBuild,
        });
        return sendJson(res, result.ok ? 200 : 502, result);
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/env$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { env?: Record<string, string> };
        const result = ctx.projectOps.setEnv(id, data.env ?? {}, user.username);
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/backup$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.backup(id, user.username);
        return sendJson(res, result.ok ? 200 : 500, result);
      }

      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/logs$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const files = listProjectLogs(proj.homeDir);
        const file = url.searchParams.get('file');
        if (file) {
          const lines = Number(url.searchParams.get('lines') ?? 200);
          return sendJson(res, 200, {
            files,
            tail: tailProjectLog(proj.homeDir, file, Number.isFinite(lines) ? lines : 200),
          });
        }
        return sendJson(res, 200, { files });
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
          homeSubdir: data.homeSubdir,
        });
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
              homeDir: proj.homeDir,
            },
            String(result.account.homePath),
          );
          result.notes.push(...ch.notes);
        }
        ctx.audit.append({
          actor: user.username,
          action: 'project.ftp.create',
          resource: id,
          detail: result,
          ok: result.ok,
        });
        return sendJson(res, result.ok ? 201 : 422, result);
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
        return sendJson(res, 200, result);
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/quota$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { quotaMb?: number };
        const result = await ctx.projectOps.setQuota(id, data.quotaMb ?? 1024, user.username);
        return sendJson(res, 200, result);
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/quota$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        return sendJson(res, 200, await ctx.projectOps.quotaStatus(id));
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
          renderPhpAdminValueLines,
        } = await import('@ysk/core');
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
          adminValueLines,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'project.php_fpm',
          resource: id,
          detail: { ...result, phpVersion, adminValueCount: adminValueLines.length },
          ok: result.ok,
        });
        return sendJson(res, result.ok || !data.enable ? 200 : 422, {
          ...result,
          phpVersion,
          adminValueCount: adminValueLines.length,
          project: ctx.projects.get(id),
        });
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
          renderPhpAdminValueLines,
        } = await import('@ysk/core');
        const global = getPhpIni(ctx.dataDir, version);
        const project = loadProjectPhpIni(ctx.dataDir, id, version);
        const effective = mergePhpIni(loadPhpIniSettings(ctx.dataDir, version), project);
        return sendJson(res, 200, {
          version,
          catalog: listPhpIniCatalog(),
          global: global.settings,
          project,
          effective,
          adminValuePreview: renderPhpAdminValueLines(effective),
          notes: [
            '專案覆寫只填要改的鍵；空白＝沿用全域',
            '部署／套用 FPM pool 時寫入 php_admin_value',
          ],
        });
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
          rawAppend: data.rawAppend ?? '',
        });
        ctx.audit.append({
          actor: user.username,
          action: 'project.php_ini.save',
          resource: id,
          detail: { written: result.written },
          ok: true,
        });
        return sendJson(res, 200, {
          ok: true,
          settings: result.settings,
          written: result.written,
          notes: ['已儲存專案 php.ini 覆寫；重新套用 FPM／部署後生效'],
        });
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
        if (!p) return sendJson(res, 404, { ok: false, message: '找不到資源' });
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
            deployEntry: p.deploy_entry,
          },
          ok: true,
        });
        return sendJson(res, 200, { project: ctx.projects.get(id) });
      }

      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/usage$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        return sendJson(res, 200, await ctx.projectOps.quotaStatus(id));
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
          forceBuiltin: data.forceBuiltin,
        });
        return sendJson(res, result.ok ? 200 : 502, result);
      }

      // Cron jobs
      if (method === 'GET' && url.pathname === '/api/v1/cron') {
        ctx.auth.authenticate(getBearer(req));
        const projectId = url.searchParams.get('projectId') ?? undefined;
        return sendJson(res, 200, { items: ctx.cron.list(projectId) });
      }
      if (method === 'GET' && url.pathname === '/api/v1/cron/status') {
        ctx.auth.authenticate(getBearer(req));
        const status = await ctx.cron.probeInstallStatus();
        return sendJson(res, 200, status);
      }
      if (method === 'POST' && url.pathname === '/api/v1/cron') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          projectId?: string;
          user?: string;
          schedule?: string;
          command?: string;
        };
        const job = ctx.cron.create({
          projectId: data.projectId,
          user: data.user ?? 'ysk',
          schedule: data.schedule ?? '0 3 * * *',
          command: data.command ?? 'true',
          actor: user.username,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'cron.create',
          resource: job.id,
          detail: job,
          ok: true,
        });
        return sendJson(res, 201, { job });
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/cron\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const ok = ctx.cron.delete(id);
        ctx.audit.append({
          actor: user.username,
          action: 'cron.delete',
          resource: id,
          detail: { ok },
          ok,
        });
        return sendJson(res, ok ? 200 : 404, { ok });
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/cron\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { enabled?: boolean };
        if (typeof data.enabled !== 'boolean') {
          return sendJson(res, 400, {
            ok: false,
            code: 'YSK_VALIDATION',
            message: '請指定啟用狀態（是／否）',
          });
        }
        const job = ctx.cron.setEnabled(id, data.enabled);
        if (!job) {
          return sendJson(res, 404, { ok: false, code: 'YSK_NOT_FOUND', message: '找不到 cron 工作' });
        }
        ctx.audit.append({
          actor: user.username,
          action: 'cron.set_enabled',
          resource: id,
          detail: { enabled: data.enabled },
          ok: true,
        });
        return sendJson(res, 200, { job });
      }
      if (method === 'POST' && url.pathname === '/api/v1/cron/install') {
        const user = ctx.auth.authenticate(getBearer(req));
        const result = await ctx.cron.installCrontab(user.username);
        ctx.audit.append({
          actor: user.username,
          action: 'cron.install',
          detail: result,
          ok: result.ok,
        });
        return sendJson(res, result.ok ? 200 : 422, result);
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/cron\/[^/]+\/run$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.cron.runNow(id, user.username);
        ctx.audit.append({
          actor: user.username,
          action: 'cron.run_now',
          resource: id,
          detail: result,
          ok: result.ok,
        });
        return sendJson(res, result.ok ? 200 : 422, result);
      }

      // Static Web UI (SPA) — after all API routes
      if (tryServeStatic(req, res, url.pathname, webRoot)) {
        return;
      }

      return sendJson(res, 404, {
        ok: false,
        code: 'YSK_NOT_FOUND',
        message: `找不到：${method} ${url.pathname}`,
        webUi: Boolean(webRoot),
      });
    } catch (err) {
      return sendError(res, err);
    }
  });
}

export async function listen(
  server: Server,
  host: string,
  port: number,
): Promise<{ host: string; port: number }> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  return { host, port };
}

function redactEmail<T extends { dkim_private_key?: string }>(e: T) {
  return { ...e, dkim_private_key: '***redacted***' };
}
