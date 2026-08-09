/**
 * System host identity — hostname/timezone, panel TLS, power/NTP.
 * Extracted from system-host.ts (Wave M3). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSystemHostIdentityRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/system/host') {
    ctx.auth.authenticate(getBearer(req));
    const { collectHostOverview } = await import('@ysk/core');
    sendJson(res, 200, await collectHostOverview(ctx.host));
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/host-identity') {
    ctx.auth.authenticate(getBearer(req));
    const { collectHostOverview } = await import('@ysk/core');
    const o = await collectHostOverview(ctx.host);
    sendJson(res, 200, {
      hostname: o.identity.hostname,
      timezone: o.identity.timezone,
      prettyHostname: o.identity.prettyHostname,
      executeEnabled: o.caps.executeEnabled,
      isRoot: o.caps.isRoot,
    });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/timezones') {
    ctx.auth.authenticate(getBearer(req));
    const { listHostTimezones, mergeTimezoneOptions, collectHostOverview } = await import(
      '@ysk/core'
    );
    const listed = await listHostTimezones(ctx.host);
    let current: string | null = null;
    try {
      const o = await collectHostOverview(ctx.host);
      current = o.identity.timezone;
    } catch {
      /* ignore */
    }
    sendJson(res, 200, {
      timezones: mergeTimezoneOptions(listed.timezones, current),
      current,
      source: listed.source,
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/host-identity') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      hostname?: string;
      timezone?: string;
      prettyHostname?: string;
    };
    const notes: string[] = [];
    if (!ctx.host.executeEnabled() || !ctx.host.isRoot()) {
      sendJson(res, 422, {
        ok: false,
        blocked: true,
        notes: [tl('notes.auto.n1190')],
      });
      return true;
    }
    let anyFail = false;
    if (data.hostname?.trim()) {
      const { setStaticHostname } = await import('@ysk/core');
      const r = await setStaticHostname(ctx.host, data.hostname.trim());
      if (r.ok) {
        notes.push(tl('system.identitySetHostname', { name: data.hostname.trim() }));
      } else {
        anyFail = true;
        notes.push(tl('notes.auto.t0795', { v0: r.detail }));
      }
    }
    // Always allow setting/clearing pretty (display) name when key is present
    if (data.prettyHostname !== undefined) {
      const { setPrettyHostname } = await import('@ysk/core');
      const pretty = String(data.prettyHostname ?? '').trim();
      const r = await setPrettyHostname(ctx.host, pretty);
      if (r.ok) {
        notes.push(
          pretty
            ? tl('system.identitySetPretty', { name: pretty })
            : tl('system.identityClearPretty'),
        );
      } else {
        anyFail = true;
        notes.push(tl('notes.auto.t0796', { v0: r.detail }));
      }
    }
    if (data.timezone?.trim()) {
      const tz = data.timezone.trim();
      const { isValidTimezoneId, listHostTimezones } = await import('@ysk/core');
      if (!isValidTimezoneId(tz)) {
        anyFail = true;
        notes.push(tl('notes.auto.t0797', { v0: 'invalid timezone id' }));
      } else {
        // Prefer host list; still allow well-formed IANA if list is fallback/short
        const listed = await listHostTimezones(ctx.host);
        if (listed.source === 'timedatectl' && !listed.timezones.includes(tz)) {
          anyFail = true;
          notes.push(tl('notes.auto.t0797', { v0: `not in host timezone list: ${tz}` }));
        } else {
          const r = await ctx.host.runCommand(['timedatectl', 'set-timezone', tz], {
            timeoutMs: 10_000,
          });
          if (r.exitCode === 0) {
            notes.push(tl('system.identitySetTimezone', { tz }));
          } else {
            anyFail = true;
            notes.push(tl('notes.auto.t0797', { v0: r.stderr || r.stdout }));
          }
        }
      }
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.host_identity',
      detail: data,
      ok: !anyFail,
    });
    sendJson(res, anyFail ? 422 : 200, { ok: !anyFail, notes });
    return true;
  }
  // —— Panel control-plane TLS (HTTPS on listenPort) ——
  if (method === 'GET' && url.pathname === '/api/v1/system/panel-tls') {
    ctx.auth.authenticate(getBearer(req));
    const { getPanelTlsStatus } = await import('@ysk/core');
    const encrypted = Boolean(
      (req.socket as { encrypted?: boolean }).encrypted,
    );
    sendJson(res, 200, {
      ...getPanelTlsStatus({
        config: ctx.config,
        servingHttps: encrypted,
      }),
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
      await import('@ysk/core');
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
    const { disablePanelTls, tryRestartPanelService } = await import('@ysk/core');
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
    const { issueAndEnablePanelTls, tryRestartPanelService } = await import('@ysk/core');
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
    const { enableHostNtp } = await import('@ysk/core');
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
    const { hostPowerAction } = await import('@ysk/core');
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
