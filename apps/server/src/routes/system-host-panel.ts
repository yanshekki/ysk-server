/**
 * Panel TLS + host NTP/power (Wave R3).
 * Extracted from system-host-identity.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSystemHostPanelRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— Panel control-plane TLS (HTTPS on listenPort) ——
  if (method === 'GET' && url.pathname === '/api/v1/system/panel-tls') {
    ctx.auth.authenticate(getBearer(req));
    const { getPanelTlsStatus } = await import('ysk-server-core');
    const encrypted = Boolean(
      (req.socket as { encrypted?: boolean }).encrypted,
    );
    let listenHostsActual: string[] = [];
    try {
      const { probeListenHosts } = await import('ysk-server-core');
      listenHostsActual = await probeListenHosts(
        ctx.host,
        ctx.config?.listenPort ?? 9287,
      );
    } catch {
      listenHostsActual = [];
    }
    const requestHost = String(req.headers.host || '').trim();
    sendJson(res, 200, {
      ...getPanelTlsStatus({
        config: ctx.config,
        servingHttps: encrypted,
        requestHost,
        listenHostsActual,
      }),
      listenHostsActual,
      configPath: ctx.configPath ?? null,
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/panel-tls/enable') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      certPath?: string;
      keyPath?: string;
      restart?: boolean;
    };
    const { enablePanelTls, tryRestartPanelService, getPanelTlsStatus } =
      await import('ysk-server-core');
    if (!ctx.configPath) {
      sendJson(res, 422, {
        ok: false,
        notes: [tl('system.panelTls.noConfig')],
        status: getPanelTlsStatus({ config: ctx.config }),
      });
      return true;
    }
    const domain =
      data.domain?.trim() ||
      ctx.config?.panelDomain ||
      '';
    const r = enablePanelTls({
      configPath: ctx.configPath,
      dataDir: ctx.dataDir,
      domain,
      certPath: data.certPath,
      keyPath: data.keyPath,
      enabled: true,
    });
    // Refresh in-memory config so subsequent status is honest
    if (r.ok && ctx.config) {
      ctx.config.tlsEnabled = true;
      ctx.config.tlsCertPath = r.status.certPath;
      ctx.config.tlsKeyPath = r.status.keyPath;
      ctx.config.panelDomain = r.status.panelDomain;
    }
    const notes = [...r.notes];
    if (r.ok && data.restart !== false) {
      const rs = await tryRestartPanelService(ctx.host);
      notes.push(...rs.notes);
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.panel_tls.enable',
      detail: { domain, ok: r.ok },
      ok: r.ok,
    });
    sendOpsResult(res, { ...r, notes, ok: r.ok });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/panel-tls/disable') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { restart?: boolean };
    const { disablePanelTls, tryRestartPanelService } = await import('ysk-server-core');
    if (!ctx.configPath) {
      sendJson(res, 422, {
        ok: false,
        notes: [tl('system.panelTls.noConfig')],
      });
      return true;
    }
    const r = disablePanelTls({ configPath: ctx.configPath });
    if (r.ok && ctx.config) {
      ctx.config.tlsEnabled = false;
    }
    const notes = [...r.notes];
    if (r.ok && data.restart !== false) {
      const rs = await tryRestartPanelService(ctx.host);
      notes.push(...rs.notes);
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.panel_tls.disable',
      detail: { ok: r.ok },
      ok: r.ok,
    });
    sendOpsResult(res, { ...r, notes, ok: r.ok });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/panel-tls/issue') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      email?: string;
      restart?: boolean;
    };
    const { issueAndEnablePanelTls, tryRestartPanelService } = await import('ysk-server-core');
    if (!ctx.configPath) {
      sendJson(res, 422, {
        ok: false,
        notes: [tl('system.panelTls.noConfig')],
      });
      return true;
    }
    const domain = data.domain?.trim() || ctx.config?.panelDomain || '';
    const email =
      data.email?.trim() ||
      `admin@${domain.replace(/^\*\./, '')}` ||
      'admin@localhost';
    const r = await issueAndEnablePanelTls({
      configPath: ctx.configPath,
      dataDir: ctx.dataDir,
      db: ctx.db,
      host: ctx.host,
      domain,
      email,
      actor: user.username,
    });
    if (r.ok && ctx.config) {
      ctx.config.tlsEnabled = true;
      ctx.config.tlsCertPath = r.status.certPath;
      ctx.config.tlsKeyPath = r.status.keyPath;
      ctx.config.panelDomain = r.status.panelDomain;
    }
    const notes = [...r.notes];
    if (r.ok && data.restart !== false) {
      const rs = await tryRestartPanelService(ctx.host);
      notes.push(...rs.notes);
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.panel_tls.issue',
      detail: { domain, ok: r.ok },
      ok: r.ok,
    });
    sendOpsResult(res, { ...r, notes, ok: r.ok });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/host/ntp-sync') {
    const user = ctx.auth.authenticate(getBearer(req));
    const { enableHostNtp } = await import('ysk-server-core');
    const r = await enableHostNtp(ctx.host);
    ctx.audit.append({
      actor: user.username,
      action: 'system.host.ntp_sync',
      detail: r,
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/host/power') {
    const user = ctx.auth.authenticate(getBearer(req));
    // Capability gate (also enforced centrally as settings.system); keep explicit for clarity
    try {
      const { requireCap } = await import('../http/rbac-guard.js');
      requireCap(ctx, user, 'settings.system');
    } catch {
      sendJson(res, 403, { ok: false, notes: [tl('notes.auto.n0563')] });
      return true;
    }
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      action?: 'reboot' | 'poweroff' | 'cancel';
      confirm?: string;
      delaySec?: number;
    };
    const action = data.action;
    if (action !== 'reboot' && action !== 'poweroff' && action !== 'cancel') {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n0217')] });
      return true;
    }
    const { hostPowerAction } = await import('ysk-server-core');
    const r = await hostPowerAction({
      host: ctx.host,
      action,
      confirm: data.confirm,
      delaySec: data.delaySec,
    });
    ctx.audit.append({
      actor: user.username,
      action:
        action === 'reboot'
          ? 'system.host.reboot'
          : action === 'poweroff'
            ? 'system.host.poweroff'
            : 'system.host.power_cancel',
      detail: {
        ok: r.ok,
        blocked: r.blocked,
        delaySec: r.delaySec,
        scheduledAt: r.scheduledAt,
        notes: r.notes,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  return false;
}
