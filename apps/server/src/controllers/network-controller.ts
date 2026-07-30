/**
 * Host network interfaces / routes / DNS — view + mutate (fail-closed).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown> | null> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function handleNetworkRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/network')) return false;

  // GET full snapshot
  if (method === 'GET' && url.pathname === '/api/v1/network') {
    ctx.auth.authenticate(getBearer(req));
    const { collectNetworkSnapshot } = await import('@ysk/core');
    const includeRaw = url.searchParams.get('raw') === '1';
    const snap = await collectNetworkSnapshot(ctx.host, { includeRaw });
    sendOpsResult(res, snap);
    return true;
  }

  // POST add addr: /api/v1/network/interfaces/:name/addr
  const addrMatch = url.pathname.match(
    /^\/api\/v1\/network\/interfaces\/([^/]+)\/addr$/,
  );
  if (addrMatch && (method === 'POST' || method === 'DELETE')) {
    const user = ctx.auth.authenticate(getBearer(req));
    const ifname = decodeURIComponent(addrMatch[1]);
    const data = await readJson(req);
    if (data == null) {
      sendJson(res, 400, { ok: false, message: 'JSON 無效' });
      return true;
    }
    const {
      networkAddAddr,
      networkDelAddr,
    } = await import('@ysk/core');
    const cidr = String(data.cidr ?? '');
    const result =
      method === 'POST'
        ? await networkAddAddr({
            host: ctx.host,
            ifname,
            cidr,
            persistent: data.persistent === true,
          })
        : await networkDelAddr({
            host: ctx.host,
            ifname,
            cidr,
            persistent: data.persistent === true,
          });
    ctx.audit.append({
      actor: user.username,
      action:
        method === 'POST' ? 'network.addr.add' : 'network.addr.del',
      resource: ifname,
      detail: { cidr, ok: result.ok, blocked: result.blocked },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  // POST link: /api/v1/network/interfaces/:name/link
  const linkMatch = url.pathname.match(
    /^\/api\/v1\/network\/interfaces\/([^/]+)\/link$/,
  );
  if (method === 'POST' && linkMatch) {
    const user = ctx.auth.authenticate(getBearer(req));
    const ifname = decodeURIComponent(linkMatch[1]);
    const data = await readJson(req);
    if (data == null) {
      sendJson(res, 400, { ok: false, message: 'JSON 無效' });
      return true;
    }
    const { networkSetLink, collectNetworkSnapshot } = await import('@ysk/core');
    // detect default egress for warning
    let isDefaultEgress = false;
    try {
      const snap = await collectNetworkSnapshot(ctx.host);
      isDefaultEgress = Boolean(
        snap.interfaces.find((i) => i.name === ifname)?.isDefaultEgress,
      );
    } catch {
      /* */
    }
    const action =
      data.action === 'up' || data.action === 'down' ? data.action : undefined;
    const mtu =
      data.mtu != null && data.mtu !== '' ? Number(data.mtu) : undefined;
    const result = await networkSetLink({
      host: ctx.host,
      ifname,
      action,
      mtu: Number.isFinite(mtu) ? mtu : undefined,
      confirmName:
        typeof data.confirmName === 'string' ? data.confirmName : undefined,
      isDefaultEgress,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'network.link.set',
      resource: ifname,
      detail: { action, mtu, ok: result.ok, blocked: result.blocked },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  // GET single interface (from full snapshot filter)
  const ifMatch = url.pathname.match(/^\/api\/v1\/network\/interfaces\/([^/]+)$/);
  if (method === 'GET' && ifMatch) {
    ctx.auth.authenticate(getBearer(req));
    const name = decodeURIComponent(ifMatch[1]);
    const { collectNetworkSnapshot } = await import('@ysk/core');
    const snap = await collectNetworkSnapshot(ctx.host);
    const iface = snap.interfaces.find((i) => i.name === name);
    if (!iface) {
      sendJson(res, 404, { ok: false, message: `找不到介面 ${name}` });
      return true;
    }
    sendJson(res, 200, { ok: true, interface: iface, caps: snap.caps });
    return true;
  }

  // Routes
  if (method === 'GET' && url.pathname === '/api/v1/network/routes') {
    ctx.auth.authenticate(getBearer(req));
    const { collectNetworkSnapshot } = await import('@ysk/core');
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
    const data = await readJson(req);
    if (data == null) {
      sendJson(res, 400, { ok: false, message: 'JSON 無效' });
      return true;
    }
    const { networkAddRoute, networkDelRoute } = await import('@ysk/core');
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
    const { collectNetworkSnapshot } = await import('@ysk/core');
    const snap = await collectNetworkSnapshot(ctx.host);
    sendJson(res, 200, { ok: true, dns: snap.dns, caps: snap.caps });
    return true;
  }

  // DNS apply via NetworkManager (persistent)
  if (method === 'PUT' && url.pathname === '/api/v1/network/dns') {
    const user = ctx.auth.authenticate(getBearer(req));
    const data = await readJson(req);
    if (data == null) {
      sendJson(res, 400, { ok: false, message: 'JSON 無效' });
      return true;
    }
    const { networkSetDns } = await import('@ysk/core');
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
    const data = await readJson(req);
    if (data == null) {
      sendJson(res, 400, { ok: false, message: 'JSON 無效' });
      return true;
    }
    const { networkTestDns } = await import('@ysk/core');
    const result = await networkTestDns({
      host: ctx.host,
      name: typeof data.name === 'string' ? data.name : 'example.com',
    });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
