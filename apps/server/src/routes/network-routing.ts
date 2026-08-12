/**
 * Host network routes + DNS (Wave Y2).
 * Extracted from network.ts. Behaviour preserved.
 */
import { tl } from '@ysk-server/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { getBearer, sendJson, sendOpsResult } from '../http/util.js';
import { readNetworkJson } from './network-shared.js';

export async function handleNetworkRoutingRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // Routes
  if (method === 'GET' && url.pathname === '/api/v1/network/routes') {
    ctx.auth.authenticate(getBearer(req));
    const { collectNetworkSnapshot } = await import('@ysk-server/core');
    const snap = await collectNetworkSnapshot(ctx.host);
    sendJson(res, 200, {
      ok: true,
      routes: snap.routes,
      defaultGateway: snap.defaultGateway,
      defaultDev: snap.defaultDev,
    });
    return true;
  }

  if (
    (method === 'POST' || method === 'DELETE') &&
    url.pathname === '/api/v1/network/routes'
  ) {
    const user = ctx.auth.authenticate(getBearer(req));
    const data = await readNetworkJson(req);
    if (data == null) {
      sendJson(res, 400, { ok: false, message: tl('errors.http.jsonInvalid') });
      return true;
    }
    const { networkAddRoute, networkDelRoute } = await import('@ysk-server/core');
    const body = {
      host: ctx.host,
      dst: String(data.dst ?? 'default'),
      gateway:
        typeof data.gateway === 'string' && data.gateway
          ? data.gateway
          : undefined,
      dev: typeof data.dev === 'string' && data.dev ? data.dev : undefined,
      confirmDefault: data.confirmDefault === true,
      persistent: data.persistent === true,
    };
    const result =
      method === 'POST'
        ? await networkAddRoute(body)
        : await networkDelRoute(body);
    ctx.audit.append({
      actor: user.username,
      action: method === 'POST' ? 'network.route.add' : 'network.route.del',
      resource: body.dst,
      detail: { ...body, host: undefined, ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  // DNS get
  if (method === 'GET' && url.pathname === '/api/v1/network/dns') {
    ctx.auth.authenticate(getBearer(req));
    const { collectNetworkSnapshot } = await import('@ysk-server/core');
    const snap = await collectNetworkSnapshot(ctx.host);
    sendJson(res, 200, { ok: true, dns: snap.dns, caps: snap.caps });
    return true;
  }

  // DNS apply via NetworkManager (persistent)
  if (method === 'PUT' && url.pathname === '/api/v1/network/dns') {
    const user = ctx.auth.authenticate(getBearer(req));
    const data = await readNetworkJson(req);
    if (data == null) {
      sendJson(res, 400, { ok: false, message: tl('errors.http.jsonInvalid') });
      return true;
    }
    const { networkSetDns } = await import('@ysk-server/core');
    const nameservers = Array.isArray(data.nameservers)
      ? data.nameservers.map(String)
      : typeof data.nameservers === 'string'
        ? String(data.nameservers)
            .split(/[\n,\s]+/)
            .filter(Boolean)
        : [];
    const search = Array.isArray(data.search)
      ? data.search.map(String)
      : typeof data.search === 'string'
        ? String(data.search).split(/[\n,\s]+/).filter(Boolean)
        : undefined;
    const mode = data.mode === 'dhcp' ? 'dhcp' : 'static';
    const result = await networkSetDns({
      host: ctx.host,
      nameservers,
      search,
      connection:
        typeof data.connection === 'string' ? data.connection : undefined,
      device: typeof data.device === 'string' ? data.device : undefined,
      mode,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'network.dns.set',
      resource: result.interface || String(data.connection || 'dns'),
      detail: {
        mode,
        nameservers,
        search,
        ok: result.ok,
        blocked: result.blocked,
      },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  // DNS test (read-only)
  if (method === 'POST' && url.pathname === '/api/v1/network/dns/test') {
    ctx.auth.authenticate(getBearer(req));
    const data = await readNetworkJson(req);
    if (data == null) {
      sendJson(res, 400, { ok: false, message: tl('errors.http.jsonInvalid') });
      return true;
    }
    const { networkTestDns } = await import('@ysk-server/core');
    const result = await networkTestDns({
      host: ctx.host,
      name: typeof data.name === 'string' ? data.name : 'example.com',
    });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
