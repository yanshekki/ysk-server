/**
 * Control-plane HTTP API — real auth, tools, projects, audit.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  CLI_NAME,
  PRODUCT_NAME,
  YskError,
  type HealthResponse,
  type ResourceScope,
  type SystemRole,
} from '@ysk/shared';
import { checkRbac, executeToolCall, evaluateProtection } from '@ysk/core';
import { applyProtection, type AppContext } from './app-context.js';
import { VERSION } from './version.js';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  });
  res.end(payload);
}

function getBearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return undefined;
  return h.slice('Bearer '.length).trim();
}

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
}

export function createHttpServer(ctx: AppContext): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        return sendJson(res, 204, {});
      }

      const url = parseUrl(req);
      const method = req.method ?? 'GET';

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

      if (method === 'GET' && url.pathname.startsWith('/api/v1/projects/')) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        return sendJson(res, 200, { project: ctx.projects.get(id) });
      }

      if (method === 'DELETE' && url.pathname.startsWith('/api/v1/projects/')) {
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
        ctx.audit.append({
          actor: user.username,
          action: 'settings.llm',
          detail: { baseUrl: data.baseUrl, model: data.model },
          ok: true,
        });
        return sendJson(res, 200, { ok: true, llm: data });
      }

      if (method === 'GET' && url.pathname === '/api/v1/settings/llm') {
        ctx.auth.authenticate(getBearer(req));
        return sendJson(res, 200, {
          llm: ctx.settings.getJson('llm') ?? {},
        });
      }

      return sendJson(res, 404, {
        ok: false,
        code: 'YSK_NOT_FOUND',
        message: `Not found: ${method} ${url.pathname}`,
      });
    } catch (err) {
      if (err instanceof YskError) {
        return sendJson(res, err.httpStatus, {
          ok: false,
          code: err.code,
          message: err.message,
          details: err.details,
        });
      }
      const message = err instanceof Error ? err.message : 'Internal error';
      return sendJson(res, 500, { ok: false, code: 'YSK_INTERNAL', message });
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
