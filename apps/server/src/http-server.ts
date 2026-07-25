/**
 * Control-plane HTTP API — real auth, tools, projects, audit.
 */

import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  CLI_NAME,
  PRODUCT_NAME,
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
  listProjectLogs,
  tailProjectLog,
  lookupOsvVulns,
  uploadCertificate,
  listUploadedCertFiles,
  applyFtps,
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
} from '@ysk/core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyProtection, type AppContext } from './app-context.js';
import { VERSION } from './version.js';
import { getBearer, parseUrl, readBody, sendError, sendJson } from './http/util.js';
import { handleFilesRoutes } from './controllers/files-controller.js';
import { handleSystemRoutes } from './controllers/system-controller.js';
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

      if (req.method === 'OPTIONS') {
        return sendJson(res, 204, {});
      }

      const url = parseUrl(req);
      const method = req.method ?? 'GET';

      // Modular controllers (files, system apply, protection probe)
      if (await handleFilesRoutes(ctx, req, res, url, method)) return;
      if (await handleSystemRoutes(ctx, req, res, url, method)) return;

      if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/v1/health')) {
        const body: HealthResponse = {
          status: ctx.protection.mode === 'normal' ? 'ok' : 'degraded',
          product: PRODUCT_NAME,
          version: ctx.version || VERSION,
          protectionMode: ctx.protection.mode,
          timestamp: new Date().toISOString(),
        };
        return sendJson(res, 200, body);
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

      if (method === 'POST' && url.pathname === '/api/v1/auth/login') {
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { username?: string; password?: string };
        const result = ctx.auth.login({
          username: data.username ?? '',
          password: data.password ?? '',
        });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && url.pathname === '/api/v1/auth/logout') {
        ctx.auth.logout(getBearer(req));
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'GET' && url.pathname === '/api/v1/auth/me') {
        const user = ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { user });
      }

      if (method === 'GET' && url.pathname === '/api/v1/audit') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: ctx.audit.listRecent(100) });
      }

      if (method === 'GET' && url.pathname === '/api/v1/projects') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, { items: ctx.projects.list() });
      }

      if (method === 'POST' && url.pathname === '/api/v1/projects') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          domain?: string;
          runtime?: 'node' | 'php' | 'static';
          runtimeVersion?: string;
          env?: 'staging' | 'production';
          templateId?: string;
          forceTemplate?: boolean;
        };
        const created = await ctx.projects.create({
          name: data.name ?? '',
          domain: data.domain,
          runtime: data.runtime ?? 'node',
          runtimeVersion: data.runtimeVersion ?? '20',
          env: data.env,
          actor: user.username,
          templateId: data.templateId,
          forceTemplate: data.forceTemplate,
        });
        return sendJson(res, 201, created);
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
          nodeVersion?: string;
          enableSystemd?: boolean;
        };
        const result = await ctx.projectOps.deployNode(id, {
          actor: user.username,
          port: data.port,
          entry: data.entry,
          nodeVersion: data.nodeVersion,
          enableSystemd: data.enableSystemd,
        });
        return sendJson(res, result.ok ? 200 : 502, result);
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
        const data = JSON.parse(raw || '{}') as { systemConfDir?: string; ssl?: boolean };
        const result = await ctx.projectOps.publishNginx(id, {
          actor: user.username,
          systemConfDir: data.systemConfDir,
          ssl: data.ssl,
        });
        return sendJson(res, 200, result);
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
          mailHostname?: string;
        };
        const created = ctx.email.create({
          domain: data.domain ?? '',
          serverIp: data.serverIp ?? '',
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
        const r = await backupAllProjects({
          host: ctx.host,
          dataDir: ctx.dataDir,
          projects: projects.map((p) => ({
            id: p.id,
            home_dir: p.home_dir,
            name: p.name,
          })),
        });
        for (const item of r.results) {
          if (item.ok && item.archivePath) {
            const p = projects.find((x) => x.id === item.projectId);
            if (p) {
              p.last_backup_path = item.archivePath;
              p.last_backup_at = new Date().toISOString();
              p.updated_at = new Date().toISOString();
            }
          }
        }
        ctx.db.persist();
        ctx.settings.setJson('last_backup_run', { at: new Date().toISOString(), ...r });
        ctx.audit.append({
          actor: user.username,
          action: 'backup.run_all',
          detail: r,
          ok: r.ok,
        });
        return sendJson(res, r.ok ? 200 : 500, r);
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
        return sendJson(res, 200, {
          files: listUploadedCertFiles(ctx.dataDir),
          certificates: ctx.db.snapshot.certificates,
        });
      }

      // FTPS apply (config under dataDir; install optional)
      if (method === 'POST' && url.pathname === '/api/v1/system/ftps/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { domain?: string; install?: boolean };
        const result = await applyFtps({
          dataDir: ctx.dataDir,
          domain: data.domain ?? 'files.local',
          host: ctx.host,
          install: data.install,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'system.ftps.apply',
          detail: result,
          ok: result.ok,
        });
        return sendJson(res, 200, result);
      }
      if (method === 'GET' && url.pathname === '/api/v1/fleet/agents') {
        ctx.auth.authenticate(getBearer(req));
        const group = url.searchParams.get('group') ?? undefined;
        return sendJson(res, 200, { items: ctx.fleet.list(group) });
      }
      if (method === 'POST' && url.pathname === '/api/v1/fleet/agents/register') {
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { agentId?: string; group?: string };
        const session = ctx.fleet.register(data.agentId ?? '', data.group);
        return sendJson(res, 200, session);
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
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/fleet\/agents\/[^/]+\/commands$/)) {
        const id = url.pathname.split('/')[5];
        return sendJson(res, 200, { items: ctx.fleet.pullCommands(id) });
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
      if (method === 'POST' && url.pathname === '/api/v1/email/dnsbl/check') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { ip?: string };
        const ip = data.ip?.trim();
        if (!ip) {
          return sendJson(res, 400, {
            ok: false,
            code: 'YSK_VALIDATION',
            message: 'ip required',
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
        const data = JSON.parse(raw || '{}') as { zone?: string; serverIp?: string };
        return sendJson(
          res,
          200,
          planDnsZone({ zone: data.zone ?? 'example.com', serverIp: data.serverIp ?? '1.2.3.4' }),
        );
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/zone-file') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          zone?: string;
          serverIp?: string;
          mailHost?: string;
          validate?: boolean;
        };
        const result = await writeManagedDnsZone({
          dataDir: ctx.dataDir,
          zone: data.zone ?? 'example.com',
          serverIp: data.serverIp ?? '203.0.113.10',
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
          mailHost?: string;
          token?: string;
          dryRun?: boolean;
        };
        const result = await applyCloudflareDns({
          zone: data.zone ?? 'example.com',
          serverIp: data.serverIp ?? '203.0.113.10',
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

      // users list (RBAC admin view)
      if (method === 'GET' && url.pathname === '/api/v1/users') {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles.includes('admin')) {
          return sendJson(res, 403, { ok: false, code: 'YSK_FORBIDDEN', message: 'admin only' });
        }
        const users = ctx.db.snapshot.users.map((u) => ({
          id: u.id,
          username: u.username,
          roles: u.roles,
          locale: u.locale,
        }));
        return sendJson(res, 200, { items: users });
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
          execute: data.execute,
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
          execute: data.execute,
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
        const data = JSON.parse(raw || '{}') as { force?: boolean };
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
        };
        const result = await ctx.projectOps.gitDeploy(id, {
          actor: user.username,
          gitUrl: data.gitUrl,
          branch: data.branch,
          redeploy: data.redeploy,
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

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/resources$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          memoryMax?: string;
          cpuQuotaPercent?: number;
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
        const result = await applyPhpFpmPool({
          dataDir: ctx.dataDir,
          poolName: proj.linuxUser,
          linuxUser: proj.linuxUser,
          phpVersion: data.phpVersion ?? proj.runtimeVersion ?? '8.2',
          host: ctx.host,
          enable: data.enable,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'project.php_fpm',
          resource: id,
          detail: result,
          ok: result.ok,
        });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy-php$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          port?: number;
          phpVersion?: string;
          enableApache?: boolean;
        };
        const result = await ctx.projectOps.deployPhp(id, {
          actor: user.username,
          port: data.port,
          phpVersion: data.phpVersion,
          enableApache: data.enableApache,
        });
        return sendJson(res, result.ok ? 200 : 502, result);
      }

      // Cron jobs
      if (method === 'GET' && url.pathname === '/api/v1/cron') {
        ctx.auth.authenticate(getBearer(req));
        const projectId = url.searchParams.get('projectId') ?? undefined;
        return sendJson(res, 200, { items: ctx.cron.list(projectId) });
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

      // Static Web UI (SPA) — after all API routes
      if (tryServeStatic(req, res, url.pathname, webRoot)) {
        return;
      }

      return sendJson(res, 404, {
        ok: false,
        code: 'YSK_NOT_FOUND',
        message: `Not found: ${method} ${url.pathname}`,
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
