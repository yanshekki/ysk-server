/**
 * VNC server + client API (PR-B: accounts CRUD + session control).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createVncService } from '@ysk/core';
import { ErrorCodes } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';
import { requireCap } from '../http/rbac-guard.js';

export async function handleVncRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/vnc')) return false;

  let user: ReturnType<AppContext['auth']['authenticate']>;
  try {
    user = ctx.auth.authenticate(getBearer(req));
    requireCap(ctx, user, 'network.vnc');
  } catch (e) {
    const err = e as { httpStatus?: number; code?: string; message?: string };
    sendJson(res, err.httpStatus ?? 403, {
      ok: false,
      code: err.code ?? ErrorCodes.FORBIDDEN,
      message: err.message ?? 'forbidden',
    });
    return true;
  }

  const vnc = createVncService(ctx.dataDir, ctx.host);

  try {
    if (method === 'GET' && url.pathname === '/api/v1/vnc/status') {
      const status = await vnc.status();
      sendJson(res, 200, {
        ok: true,
        ...status,
        clientProfiles: [],
      });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/v1/vnc/settings') {
      sendJson(res, 200, { ok: true, settings: vnc.loadSettings() });
      return true;
    }

    if (method === 'PATCH' && url.pathname === '/api/v1/vnc/settings') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as Record<string, unknown>;
      const settings = vnc.saveSettings({
        defaultDesktop:
          data.defaultDesktop === 'xfce' ||
          data.defaultDesktop === 'minimal' ||
          data.defaultDesktop === 'none'
            ? data.defaultDesktop
            : undefined,
        defaultGeometry:
          typeof data.defaultGeometry === 'string' ? data.defaultGeometry : undefined,
        defaultDepth:
          typeof data.defaultDepth === 'number' ? data.defaultDepth : undefined,
        defaultRfbBind:
          data.defaultRfbBind === 'localhost' || data.defaultRfbBind === 'all'
            ? data.defaultRfbBind
            : undefined,
        defaultAutostart:
          typeof data.defaultAutostart === 'boolean' ? data.defaultAutostart : undefined,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'vnc.settings.patch',
        detail: { keys: Object.keys(data) },
        ok: true,
      });
      sendJson(res, 200, { ok: true, settings });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/v1/vnc/accounts') {
      sendJson(res, 200, { ok: true, items: await vnc.listAccounts() });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/v1/vnc/accounts') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        name?: string;
        password?: string;
        desktop?: string;
        geometry?: string;
        depth?: number;
        rfbBind?: string;
        autostart?: boolean;
        display?: number;
        start?: boolean;
      };
      const result = await vnc.createAccount({
        name: data.name ?? '',
        password: data.password,
        desktop:
          data.desktop === 'xfce' || data.desktop === 'minimal' || data.desktop === 'none'
            ? data.desktop
            : undefined,
        geometry: data.geometry,
        depth: data.depth,
        rfbBind:
          data.rfbBind === 'localhost' || data.rfbBind === 'all'
            ? data.rfbBind
            : undefined,
        autostart: data.autostart,
        display: data.display,
        start: data.start,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'vnc.account.create',
        resource: result.account?.linuxUser,
        detail: { id: result.account?.id, ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        notes: result.notes,
        blocked: result.blocked,
        requiresExecute: result.requiresExecute,
        requiresRoot: result.requiresRoot,
        account: result.account,
        apply_status: result.blocked
          ? 'blocked'
          : result.ok
            ? 'applied'
            : 'failed',
      });
      return true;
    }

    // Short-lived noVNC view ticket info (authenticated)
    const viewMatch = url.pathname.match(/^\/api\/v1\/vnc\/view\/([^/]+)$/);
    if (method === 'GET' && viewMatch) {
      const { consumeViewTicket } = await import('@ysk/core');
      const ticket = consumeViewTicket(ctx.dataDir, decodeURIComponent(viewMatch[1] ?? ''));
      if (!ticket) {
        sendJson(res, 404, {
          ok: false,
          code: ErrorCodes.NOT_FOUND,
          message: 'ticket expired or missing',
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        accountId: ticket.accountId,
        httpPort: ticket.httpPort,
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        localUrl: `http://127.0.0.1:${ticket.httpPort}/vnc.html?host=127.0.0.1&port=${ticket.httpPort}`,
        notes: [
          'Open localUrl on the server or SSH-tunnel the httpPort; RFB stays on localhost.',
        ],
      });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/v1/vnc/firewall/open') {
      requireCap(ctx, user, 'firewall.edit');
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as { port?: number; accountId?: string };
      let port = Number(data.port);
      if (data.accountId) {
        const conn = await vnc.getConnection(data.accountId);
        port = conn.account.rfbPort;
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        sendJson(res, 400, {
          ok: false,
          code: ErrorCodes.VALIDATION,
          message: 'invalid port',
        });
        return true;
      }
      const { openUfwTcpPort } = await import('@ysk/core');
      const result = await openUfwTcpPort({
        host: ctx.host,
        port,
        comment: 'ysk-vnc',
      });
      ctx.audit.append({
        actor: user.username,
        action: 'vnc.firewall.open',
        detail: { port, ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        notes: result.notes,
        blocked: result.blocked,
        requiresExecute: result.requiresExecute,
        apply_status: result.blocked
          ? 'blocked'
          : result.ok
            ? 'applied'
            : 'failed',
      });
      return true;
    }

    const accountMatch = url.pathname.match(
      /^\/api\/v1\/vnc\/accounts\/([^/]+)(?:\/(start|stop|password|connection|novnc\/start|novnc\/stop|firewall))?$/,
    );
    if (accountMatch) {
      const accountId = decodeURIComponent(accountMatch[1] ?? '');
      const action = accountMatch[2];

      if (method === 'GET' && action === 'connection') {
        const result = await vnc.getConnection(accountId);
        sendJson(res, 200, result);
        return true;
      }

      if (method === 'POST' && action === 'novnc/start') {
        const result = await vnc.startNovncForAccount(accountId);
        ctx.audit.append({
          actor: user.username,
          action: 'vnc.novnc.start',
          resource: accountId,
          ok: result.ok,
        });
        sendOpsResult(res, {
          ok: result.ok,
          notes: result.notes,
          blocked: result.blocked,
          requiresExecute: result.requiresExecute,
          account: result.account,
          apply_status: result.blocked
            ? 'blocked'
            : result.ok
              ? 'applied'
              : 'failed',
        });
        return true;
      }

      if (method === 'POST' && action === 'novnc/stop') {
        const result = await vnc.stopNovncForAccount(accountId);
        ctx.audit.append({
          actor: user.username,
          action: 'vnc.novnc.stop',
          resource: accountId,
          ok: result.ok,
        });
        sendOpsResult(res, {
          ok: result.ok,
          notes: result.notes,
          blocked: result.blocked,
          requiresExecute: result.requiresExecute,
          account: result.account,
          apply_status: result.blocked
            ? 'blocked'
            : result.ok
              ? 'applied'
              : 'failed',
        });
        return true;
      }

      if (method === 'POST' && action === 'firewall') {
        requireCap(ctx, user, 'firewall.edit');
        const result = await vnc.openFirewallForAccount(accountId);
        ctx.audit.append({
          actor: user.username,
          action: 'vnc.firewall.account',
          resource: accountId,
          ok: result.ok,
        });
        sendOpsResult(res, {
          ok: result.ok,
          notes: result.notes,
          blocked: result.blocked,
          requiresExecute: result.requiresExecute,
          account: result.account,
          apply_status: result.blocked
            ? 'blocked'
            : result.ok
              ? 'applied'
              : 'failed',
        });
        return true;
      }

      if (method === 'PATCH' && !action) {
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          desktop?: string;
          geometry?: string;
          depth?: number;
          rfbBind?: string;
          autostart?: boolean;
        };
        const result = await vnc.updateAccount(accountId, {
          name: data.name,
          desktop:
            data.desktop === 'xfce' ||
            data.desktop === 'minimal' ||
            data.desktop === 'none'
              ? data.desktop
              : undefined,
          geometry: data.geometry,
          depth: data.depth,
          rfbBind:
            data.rfbBind === 'localhost' || data.rfbBind === 'all'
              ? data.rfbBind
              : undefined,
          autostart: data.autostart,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'vnc.account.update',
          resource: accountId,
          ok: result.ok,
        });
        sendOpsResult(res, {
          ok: result.ok,
          notes: result.notes,
          account: result.account,
          apply_status: result.ok ? 'written' : 'failed',
        });
        return true;
      }

      if (method === 'DELETE' && !action) {
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { removeLinuxUser?: boolean };
        const result = await vnc.deleteAccount(accountId, {
          removeLinuxUser: Boolean(data.removeLinuxUser),
        });
        ctx.audit.append({
          actor: user.username,
          action: 'vnc.account.delete',
          resource: accountId,
          detail: { removeLinuxUser: data.removeLinuxUser },
          ok: result.ok,
        });
        sendOpsResult(res, {
          ok: result.ok,
          notes: result.notes,
          blocked: result.blocked,
          requiresExecute: result.requiresExecute,
          apply_status: result.ok ? 'applied' : 'failed',
        });
        return true;
      }

      if (method === 'POST' && action === 'start') {
        const result = await vnc.startAccount(accountId);
        ctx.audit.append({
          actor: user.username,
          action: 'vnc.account.start',
          resource: accountId,
          ok: result.ok,
        });
        sendOpsResult(res, {
          ok: result.ok,
          notes: result.notes,
          blocked: result.blocked,
          requiresExecute: result.requiresExecute,
          requiresRoot: result.requiresRoot,
          account: result.account,
          apply_status: result.blocked
            ? 'blocked'
            : result.ok
              ? 'applied'
              : 'failed',
        });
        return true;
      }

      if (method === 'POST' && action === 'stop') {
        const result = await vnc.stopAccount(accountId);
        ctx.audit.append({
          actor: user.username,
          action: 'vnc.account.stop',
          resource: accountId,
          ok: result.ok,
        });
        sendOpsResult(res, {
          ok: result.ok,
          notes: result.notes,
          blocked: result.blocked,
          requiresExecute: result.requiresExecute,
          account: result.account,
          apply_status: result.blocked
            ? 'blocked'
            : result.ok
              ? 'applied'
              : 'failed',
        });
        return true;
      }

      if (method === 'POST' && action === 'password') {
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { password?: string };
        const result = await vnc.setPassword(accountId, data.password ?? '');
        ctx.audit.append({
          actor: user.username,
          action: 'vnc.account.password',
          resource: accountId,
          ok: result.ok,
        });
        sendOpsResult(res, {
          ok: result.ok,
          notes: result.notes,
          blocked: result.blocked,
          requiresExecute: result.requiresExecute,
          account: result.account,
          apply_status: result.blocked
            ? 'blocked'
            : result.ok
              ? 'applied'
              : 'failed',
        });
        return true;
      }
    }

    if (method === 'GET' && url.pathname === '/api/v1/vnc/client/profiles') {
      sendJson(res, 200, { ok: true, items: [] });
      return true;
    }

    sendJson(res, 404, {
      ok: false,
      code: ErrorCodes.NOT_FOUND,
      message: 'not found',
    });
    return true;
  } catch (e) {
    const err = e as { httpStatus?: number; code?: string; message?: string };
    sendJson(res, err.httpStatus ?? 500, {
      ok: false,
      code: err.code ?? ErrorCodes.INTERNAL,
      message: err.message ?? String(e),
    });
    return true;
  }
}
