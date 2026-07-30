/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  probeAllAgentRuntimes,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
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
        const probes = await probeAllAgentRuntimes(ctx.host);
        sendJson(res, 200, { items: probes });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/fleet/agents') {
        ctx.auth.authenticate(getBearer(req));
        const group = url.searchParams.get('group') ?? undefined;
        sendJson(res, 200, { items: ctx.fleet.list(group) });
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
  return false;
}
