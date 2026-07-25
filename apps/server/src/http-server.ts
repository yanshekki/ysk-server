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
} from '@ysk/core';
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
        };
        const created = await ctx.projects.create({
          name: data.name ?? '',
          domain: data.domain,
          runtime: data.runtime ?? 'node',
          runtimeVersion: data.runtimeVersion ?? '20',
          env: data.env,
          actor: user.username,
        });
        return sendJson(res, 201, created);
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
        const inv = await collectInventory(ctx.host);
        const advice = adviseInventory(inv);
        return sendJson(res, 200, { inventory: inv, advice });
      }
      if (method === 'GET' && url.pathname === '/api/v1/updates/self') {
        ctx.auth.authenticate(getBearer(req));
        const latest = process.env.YSK_LATEST_VERSION ?? VERSION;
        return sendJson(res, 200, planSelfUpdate({ current: VERSION, latest }));
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
