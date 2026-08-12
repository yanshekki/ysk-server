/**
 * Host network interfaces — snapshot / addr / link (Wave Y2).
 * Extracted from network.ts. Behaviour preserved.
 */
import { tl } from '@yanshekki/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { getBearer, sendJson, sendOpsResult } from '../http/util.js';
import { readNetworkJson } from './network-shared.js';

export async function handleNetworkIfacesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // GET full snapshot
  if (method === 'GET' && url.pathname === '/api/v1/network') {
    ctx.auth.authenticate(getBearer(req));
    const { collectNetworkSnapshot } = await import('@yanshekki/core');
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
    const data = await readNetworkJson(req);
    if (data == null) {
      sendJson(res, 400, { ok: false, message: tl('errors.http.jsonInvalid') });
      return true;
    }
    const {
      networkAddAddr,
      networkDelAddr,
    } = await import('@yanshekki/core');
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
    const data = await readNetworkJson(req);
    if (data == null) {
      sendJson(res, 400, { ok: false, message: tl('errors.http.jsonInvalid') });
      return true;
    }
    const { networkSetLink, collectNetworkSnapshot } = await import('@yanshekki/core');
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
    const { collectNetworkSnapshot } = await import('@yanshekki/core');
    const snap = await collectNetworkSnapshot(ctx.host);
    const iface = snap.interfaces.find((i) => i.name === name);
    if (!iface) {
      sendJson(res, 404, { ok: false, message: tl('notes.auto.t0794', { v0: (name) }) });
      return true;
    }
    sendJson(res, 200, { ok: true, interface: iface, caps: snap.caps });
    return true;
  }

  return false;
}
