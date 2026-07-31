/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  probeAllAgentRuntimes,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import {
  getBearer,
  readBody,
  sendJson,
} from '../http/util.js';

export async function handleAgentsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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
        sendJson(res, 200, session);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/agents/runtimes') {
        ctx.auth.authenticate(getBearer(req));
        type Probe = { kind?: string; id?: string; name?: string; status?: string; version?: string };
        const probes = (await probeAllAgentRuntimes(ctx.host)) as unknown as Probe[];
        const { items, meta } = listWithQuery(url, probes, {
          text: (p: Probe) => [
            String(p.kind ?? p.id ?? ''),
            String(p.name ?? ''),
            String(p.status ?? ''),
            String(p.version ?? ''),
          ],
        });
        sendJson(res, 200, { items, meta });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/fleet/agents') {
        ctx.auth.authenticate(getBearer(req));
        const group = url.searchParams.get('group') ?? undefined;
        type Agent = {
          id?: string;
          agentId?: string;
          group?: string;
          status?: string;
          hostname?: string;
          host?: string;
        };
        const all = ctx.fleet.list(group) as unknown as Agent[];
        const { items, meta } = listWithQuery(
          url,
          all,
          {
            text: (a: Agent) => [
              String(a.id ?? a.agentId ?? ''),
              String(a.group ?? ''),
              String(a.status ?? ''),
              String(a.hostname ?? a.host ?? ''),
            ],
            predicates: {
              status: (a: Agent, v: string) => String(a.status ?? '') === v,
            },
            facetOf: {
              status: (a: Agent) => String(a.status ?? 'unknown'),
            },
          },
          { enums: { status: ['online', 'offline', 'stale', 'unknown'] }, freeFilters: ['group'] },
        );
        sendJson(res, 200, { items, meta });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/fleet/agents/register') {
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          agentId?: string;
          group?: string;
          meta?: Record<string, unknown>;
        };
        const session = ctx.fleet.register(data.agentId ?? '', data.group, data.meta);
        sendJson(res, 200, session);
        return true;
      }
      // —— Fleet agent poller (heartbeat / pull / ack) + panel command history ——
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
        sendJson(res, 200, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/fleet\/agents\/[^/]+\/heartbeat$/)) {
        const id = url.pathname.split('/')[5];
        sendJson(res, 200, ctx.fleet.heartbeat(id));
        return true;
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
        sendJson(res, 200, cmd);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/fleet\/agents\/[^/]+\/commands$/)) {
        const id = url.pathname.split('/')[5];
        const history = url.searchParams.get('history') === '1';
        if (history) {
          ctx.auth.authenticate(getBearer(req));
          sendJson(res, 200, { items: ctx.fleet.listCommands(id) });
          return true;
        }
        sendJson(res, 200, { items: ctx.fleet.pullCommands(id) });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/fleet\/commands\/[^/]+\/ack$/)) {
        const cmdId = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { result?: unknown; error?: boolean };
        const cmd = ctx.fleet.ack(cmdId, data.result, Boolean(data.error));
        if (!cmd) {
          sendJson(res, 404, { error: 'command not found' });
          return true;
        }
        sendJson(res, 200, cmd);
        return true;
      }
  return false;
}
