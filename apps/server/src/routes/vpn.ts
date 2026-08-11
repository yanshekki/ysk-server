/**
 * VPN server + client API.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createVpnService, parseEngine, normalizeProto } from '@ysk/core';
import { ErrorCodes } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';
import { requireCap } from '../http/rbac-guard.js';

function sendErr(
  res: ServerResponse,
  status: number,
  message: string,
  code: string = ErrorCodes.VALIDATION,
): void {
  sendJson(res, status, { ok: false, code, message });
}

export async function handleVpnRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/vpn')) return false;

  let user: ReturnType<AppContext['auth']['authenticate']>;
  try {
    user = ctx.auth.authenticate(getBearer(req));
    requireCap(ctx, user, 'network.vpn');
  } catch (e) {
    const err = e as { httpStatus?: number; code?: string; message?: string };
    sendJson(res, err.httpStatus ?? 403, {
      ok: false,
      code: err.code ?? ErrorCodes.FORBIDDEN,
      message: err.message ?? 'forbidden',
    });
    return true;
  }

  const vpn = createVpnService(ctx.dataDir, ctx.host);

  try {
    if (method === 'GET' && url.pathname === '/api/v1/vpn/status') {
      const status = await vpn.status();
      const clients = await vpn.refreshClientStatuses(vpn.listClientProfiles());
      sendJson(res, 200, {
        ok: true,
        ...status,
        serverPeers: [
          ...vpn.listServerPeers('wireguard'),
          ...vpn.listServerPeers('openvpn'),
          ...vpn.listServerPeers('outline'),
        ],
        clientProfiles: clients,
        portPresets: vpn.portPresets(),
      });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/v1/vpn/monitor') {
      const engRaw = url.searchParams.get('engine');
      const engine =
        engRaw === 'wireguard' || engRaw === 'openvpn' || engRaw === 'outline'
          ? engRaw
          : undefined;
      const snap = await vpn.monitor(engine ? { engine } : undefined);
      sendJson(res, 200, { ok: true, ...snap });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/v1/vpn/ports') {
      const engine = parseEngine(url.searchParams.get('engine'));
      sendJson(res, 200, { ok: true, presets: vpn.portPresets(engine) });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/v1/vpn/server/ensure') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        engine?: string;
        listenPort?: number;
        endpoint?: string;
        dns?: string;
        proto?: string;
      };
      const engine = parseEngine(data.engine);
      const result = await vpn.ensureServer({
        engine,
        listenPort: data.listenPort,
        endpoint: data.endpoint,
        dns: data.dns,
        proto: data.proto === 'tcp' ? 'tcp' : 'udp',
      });
      ctx.audit.append({
        actor: user.username,
        action: 'vpn.server.ensure',
        detail: { engine, port: data.listenPort, ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        apply_status: result.ok ? 'applied' : result.blocked ? 'blocked' : 'failed',
        blocked: result.blocked,
        requiresExecute: result.requiresExecute,
        notes: result.notes,
      });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/v1/vpn/server/clients') {
      const eng = parseEngine(url.searchParams.get('engine'));
      const peers =
        eng === 'openvpn'
          ? vpn.listServerPeers('openvpn')
          : eng === 'wireguard'
            ? vpn.listServerPeers('wireguard')
            : [
                ...vpn.listServerPeers('wireguard'),
                ...vpn.listServerPeers('openvpn'),
              ];
      sendJson(res, 200, { ok: true, peers });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/v1/vpn/server/clients') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as { name?: string; engine?: string };
      if (!data.name?.trim()) {
        sendErr(res, 400, 'name required');
        return true;
      }
      const result = await vpn.addServerPeer({
        name: data.name,
        engine: parseEngine(data.engine),
      });
      ctx.audit.append({
        actor: user.username,
        action: 'vpn.server.client.create',
        resource: result.peer?.id,
        detail: { name: data.name, ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        apply_status: result.ok ? 'applied' : result.blocked ? 'blocked' : 'failed',
        blocked: result.blocked,
        requiresExecute: result.requiresExecute,
        notes: result.notes,
        peer: result.peer,
        config: result.config,
      });
      return true;
    }

    const peerCfg = url.pathname.match(
      /^\/api\/v1\/vpn\/server\/clients\/([^/]+)\/config$/,
    );
    if (method === 'GET' && peerCfg) {
      const got = vpn.getServerPeerConfig(peerCfg[1]);
      if (!got) {
        sendErr(res, 404, 'peer not found', ErrorCodes.NOT_FOUND);
        return true;
      }
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(got.filename)}`,
        'Cache-Control': 'no-store',
      });
      res.end(got.config);
      return true;
    }

    const peerDel = url.pathname.match(/^\/api\/v1\/vpn\/server\/clients\/([^/]+)$/);
    if (method === 'DELETE' && peerDel) {
      const result = await vpn.deleteServerPeer(peerDel[1]);
      ctx.audit.append({
        actor: user.username,
        action: 'vpn.server.client.delete',
        resource: peerDel[1],
        detail: { ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        apply_status: result.ok ? 'applied' : 'failed',
        notes: result.notes,
      });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/v1/vpn/client/profiles') {
      const profiles = await vpn.refreshClientStatuses(vpn.listClientProfiles());
      sendJson(res, 200, { ok: true, profiles });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/v1/vpn/client/profiles') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        name?: string;
        engine?: string;
        conf?: string;
        autostart?: boolean;
      };
      if (!data.name?.trim() || !data.conf?.trim()) {
        sendErr(res, 400, 'name and conf required');
        return true;
      }
      const result = await vpn.importClientProfile({
        name: data.name,
        engine: parseEngine(data.engine),
        conf: data.conf,
        autostart: data.autostart,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'vpn.client.import',
        resource: result.profile?.id,
        detail: { ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        apply_status: result.ok ? 'written' : 'failed',
        notes: result.notes,
        profile: result.profile,
      });
      return true;
    }

    const clientUp = url.pathname.match(
      /^\/api\/v1\/vpn\/client\/profiles\/([^/]+)\/up$/,
    );
    if (method === 'POST' && clientUp) {
      const result = await vpn.clientUp(clientUp[1]);
      ctx.audit.append({
        actor: user.username,
        action: 'vpn.client.up',
        resource: clientUp[1],
        detail: { ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        apply_status: result.ok ? 'applied' : result.blocked ? 'blocked' : 'failed',
        blocked: result.blocked,
        requiresExecute: result.requiresExecute,
        notes: result.notes,
      });
      return true;
    }

    const clientDown = url.pathname.match(
      /^\/api\/v1\/vpn\/client\/profiles\/([^/]+)\/down$/,
    );
    if (method === 'POST' && clientDown) {
      const result = await vpn.clientDown(clientDown[1]);
      ctx.audit.append({
        actor: user.username,
        action: 'vpn.client.down',
        resource: clientDown[1],
        detail: { ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        apply_status: result.ok ? 'applied' : 'failed',
        notes: result.notes,
      });
      return true;
    }

    const clientDel = url.pathname.match(
      /^\/api\/v1\/vpn\/client\/profiles\/([^/]+)$/,
    );
    if (method === 'DELETE' && clientDel) {
      const result = await vpn.deleteClientProfile(clientDel[1]);
      ctx.audit.append({
        actor: user.username,
        action: 'vpn.client.delete',
        resource: clientDel[1],
        detail: { ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        apply_status: result.ok ? 'applied' : 'failed',
        notes: result.notes,
      });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/v1/vpn/firewall/open') {
      requireCap(ctx, user, 'firewall.edit');
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        port?: number;
        proto?: string;
      };
      const port = Number(data.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        sendErr(res, 400, 'invalid port');
        return true;
      }
      const proto = normalizeProto(data.proto);
      if (!ctx.host.executeEnabled()) {
        sendOpsResult(res, {
          ok: false,
          blocked: true,
          requiresExecute: true,
          apply_status: 'blocked',
          notes: ['Opening ports requires YSK_EXECUTE'],
        });
        return true;
      }
      const cmds: string[] = [];
      if (proto === 'udp' || proto === 'both') {
        cmds.push(`ufw allow ${port}/udp comment 'ysk-vpn'`);
      }
      if (proto === 'tcp' || proto === 'both') {
        cmds.push(`ufw allow ${port}/tcp comment 'ysk-vpn'`);
      }
      const r = await ctx.host.runCommand(['bash', '-c', cmds.join(' && ')], {
        timeoutMs: 30_000,
      });
      const ok = r.exitCode === 0;
      ctx.audit.append({
        actor: user.username,
        action: 'vpn.firewall.open',
        detail: { port, proto, ok },
        ok,
      });
      sendOpsResult(res, {
        ok,
        apply_status: ok ? 'applied' : 'failed',
        notes: ok
          ? [`Opened ${port}/${proto === 'both' ? 'tcp+udp' : proto}`]
          : [(r.stderr || r.stdout || 'ufw failed').slice(0, 200)],
      });
      return true;
    }

    sendErr(res, 404, 'Not found', ErrorCodes.NOT_FOUND);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, 500, { ok: false, code: ErrorCodes.INTERNAL, message: msg });
    return true;
  }
}
