/**
 * System host network — real-IP, IPs inventory, FTPS.
 * Extracted from system-host.ts (Wave M3). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyFtps,
  applyFtpsService,
  loadFtpsSettings,
  saveFtpsSettings,
  probeFtpsStatus,
  listFtpHomeOptions,
  listFtpDomainOptions,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSystemHostNetRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // Multi-CDN real client IP + host IP inventory (moved from misc)
  if (method === 'GET' && url.pathname === '/api/v1/system/real-ip') {
    ctx.auth.authenticate(getBearer(req));
    const {
      loadRealIpConfig,
      listRealIpProviders,
      realIpProviderSummary,
    } = await import('@ysk/core');
    const config = loadRealIpConfig(ctx.dataDir);
    sendJson(res, 200, {
      config,
      providers: realIpProviderSummary(),
      catalog: listRealIpProviders().map((p) => ({
        id: p.id,
        label: p.label,
        clientIpHeader: p.clientIpHeader,
        hasSources: Boolean(p.cidrSources?.ipv4 || p.cidrSources?.ipv6),
        snapshotCount: p.snapshotIpv4.length + p.snapshotIpv6.length,
      })),
    });
    return true;
  }
  if (method === 'PATCH' && url.pathname === '/api/v1/system/real-ip') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}') as Record<string, unknown>;
    const { patchRealIpConfig, applyRealIpArtifacts } = await import('@ysk/core');
    const config = patchRealIpConfig(ctx.dataDir, {
      defaultProvider: body.defaultProvider as never,
      trustMode: body.trustMode as never,
      enabledProviders: body.enabledProviders as never,
      customCidrs: body.customCidrs as never,
      customHeader: body.customHeader as never,
    });
    const art = await applyRealIpArtifacts({
      dataDir: ctx.dataDir,
      host: ctx.host,
      enableApacheRemoteIp: Boolean(body.enableApacheRemoteIp),
    });
    sendOpsResult(res, {
      ok: true,
      config,
      notes: art.notes,
      written: art.written,
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/real-ip/refresh') {
    ctx.auth.authenticate(getBearer(req));
    const { refreshRealIpCidrs, applyRealIpArtifacts } = await import('@ysk/core');
    const r = await refreshRealIpCidrs({ dataDir: ctx.dataDir, host: ctx.host });
    const art = await applyRealIpArtifacts({ dataDir: ctx.dataDir });
    sendOpsResult(res, {
      ok: r.ok,
      config: r.config,
      updated: r.updated,
      notes: [...r.notes, ...art.notes],
    });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/ips') {
    ctx.auth.authenticate(getBearer(req));
    // Prefer argv form (read-only allowlist) — free-form bash is fail-closed without EXECUTE
    let r = await ctx.host.runCommand(['hostname', '-I'], { timeoutMs: 5_000 });
    let text = r.stdout || '';
    if (r.exitCode !== 0 || !text.trim()) {
      r = await ctx.host.runCommand(['ip', '-4', '-o', 'addr', 'show'], { timeoutMs: 5_000 });
      text = (r.stdout || '')
        .split('\n')
        .map((line) => {
          const m = line.match(/\binet\s+(\d+\.\d+\.\d+\.\d+)/);
          return m?.[1] ?? '';
        })
        .filter(Boolean)
        .join(' ');
    }
    const ips = text
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    sendJson(res, 200, { items: ips });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/ftps/settings') {
    ctx.auth.authenticate(getBearer(req));
    const settings = loadFtpsSettings(ctx.db);
    const status = await probeFtpsStatus({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
    });
    sendJson(res, 200, { settings, status });
    return true;
  }
  if (method === 'PUT' && url.pathname === '/api/v1/system/ftps/settings') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const settings = saveFtpsSettings(ctx.db, data);
    ctx.audit.append({
      actor: user.username,
      action: 'system.ftps.settings.save',
      detail: { keys: Object.keys(data) },
      ok: true,
    });
    sendJson(res, 200, { ok: true, settings });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/ftps/status') {
    ctx.auth.authenticate(getBearer(req));
    const status = await probeFtpsStatus({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
    });
    sendJson(res, 200, status);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/ftps/options') {
    ctx.auth.authenticate(getBearer(req));
    const username = url.searchParams.get('username') ?? undefined;
    sendJson(res, 200, {
      domains: listFtpDomainOptions(ctx.db),
      homes: listFtpHomeOptions({ db: ctx.db, dataDir: ctx.dataDir, username }),
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/ftps/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      install?: boolean;
      applySystem?: boolean;
      settings?: Record<string, unknown>;
    };
    // Prefer full service apply with store; fall back to legacy domain-only
    const applySystem = data.applySystem !== false && data.install !== false;
    let result: Record<string, unknown>;
    if (data.settings || applySystem) {
      result = (await applyFtpsService({
        db: ctx.db,
        dataDir: ctx.dataDir,
        host: ctx.host,
        applySystem,
        settingsPatch: {
          ...(data.settings as object),
          ...(data.domain ? { sslDomain: data.domain } : {}),
        },
      })) as unknown as Record<string, unknown>;
    } else {
      result = (await applyFtps({
        dataDir: ctx.dataDir,
        domain: data.domain ?? 'files.local',
        host: ctx.host,
        install: data.install,
      })) as unknown as Record<string, unknown>;
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.ftps.apply',
      detail: result,
      ok: Boolean(result.ok),
    });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
