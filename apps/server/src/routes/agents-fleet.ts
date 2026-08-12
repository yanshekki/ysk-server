/**
 * Fleet agents register / heartbeat / commands (Wave X3).
 * Extracted from agents.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ErrorCodes } from '@ysk-server/shared';
import type { AppContext } from '../app-context.js';
import { getAgentToken } from '../http/auth-guards.js';
import { listWithQuery } from '../http/list-response.js';
import { getBearer, readBody, sendJson } from '../http/util.js';

function enrollTokenOk(ctx: AppContext, provided: string | undefined): boolean {
  const expected =
    process.env.YSK_FLEET_ENROLL_TOKEN?.trim() ||
    String(ctx.db.snapshot.settings?.['fleet.enroll_token'] ?? '').trim();
  if (!expected) return false;
  return Boolean(provided && provided === expected);
}

/** Panel session auth OR valid enrollment token. */
function assertFleetRegisterAuth(
  ctx: AppContext,
  req: IncomingMessage,
  bodyEnroll?: string,
): { actor: string } {
  const enroll =
    bodyEnroll ||
    (typeof req.headers['x-ysk-enroll'] === 'string' ? req.headers['x-ysk-enroll'] : undefined);
  if (enrollTokenOk(ctx, enroll)) {
    return { actor: 'edge-enroll' };
  }
  const user = ctx.auth.authenticate(getBearer(req));
  return { actor: user.username };
}

export async function handleAgentsFleetRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/agents/register') {
    // Legacy path: require panel auth (no longer open)
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { agentId?: string };
    const session = ctx.agents.register(data.agentId ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'agent.register',
      detail: { id: (session as { id?: string }).id },
      ok: true,
    });
    sendJson(res, 200, session);
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
      enrollToken?: string;
    };
    const { actor } = assertFleetRegisterAuth(ctx, req, data.enrollToken);
    const session = ctx.fleet.register(data.agentId ?? '', data.group, data.meta);
    ctx.audit.append({
      actor,
      action: 'fleet.register',
      resource: session.id,
      detail: { agent_id: session.agent_id, group: session.group },
      ok: true,
    });
    // token shown once
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
    const id = url.pathname.split('/')[5]!;
    ctx.fleet.assertAgentAuth(id, getAgentToken(req));
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
    const id = url.pathname.split('/')[5]!;
    const history = url.searchParams.get('history') === '1';
    if (history) {
      ctx.auth.authenticate(getBearer(req));
      sendJson(res, 200, { items: ctx.fleet.listCommands(id) });
      return true;
    }
    // Edge pull — agent token required
    ctx.fleet.assertAgentAuth(id, getAgentToken(req));
    sendJson(res, 200, { items: ctx.fleet.pullCommands(id) });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/fleet\/commands\/[^/]+\/ack$/)) {
    const cmdId = url.pathname.split('/')[5]!;
    const sessionId = ctx.fleet.getCommandSessionId(cmdId);
    if (!sessionId) {
      sendJson(res, 404, { ok: false, code: ErrorCodes.NOT_FOUND, message: 'command not found' });
      return true;
    }
    ctx.fleet.assertAgentAuth(sessionId, getAgentToken(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { result?: unknown; error?: boolean };
    const cmd = ctx.fleet.ack(cmdId, data.result, Boolean(data.error));
    if (!cmd) {
      sendJson(res, 404, { ok: false, code: ErrorCodes.NOT_FOUND, message: 'command not found' });
      return true;
    }
    sendJson(res, 200, cmd);
    return true;
  }

  return false;
}
