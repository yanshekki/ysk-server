import { tl } from '@ysk/shared';
/**
 * System apply routes — /api/v1/system/* and updates/self/apply.
 * Defense/protection/geoip live in routes/defense.ts (Wave C1).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyEmailStack,
  applyLetsEncrypt,
  applyPhpHosting,
  applyFtps,
  applyFtpsService,
  loadFtpsSettings,
  saveFtpsSettings,
  probeFtpsStatus,
  listFtpHomeOptions,
  listFtpDomainOptions,
  installDbEngine,
  startDbEngine,
  unfreezeDbEngine,
  installRedisService,
  startRedisService,
  listRedisKeys,
  getRedisKey,
  setRedisString,
  deleteRedisKey,
  loadRedisSettings,
  saveRedisSettings,
  applyRedisServiceConfig,
  getRedisServiceView,
  loadSqlSettings,
  saveSqlSettings,
  applySqlServiceConfig,
  getSqlServiceView,
  loadPostgresSettings,
  savePostgresSettings,
  applyPostgresServiceConfig,
  getPostgresServiceView,
  getServiceConsole,
  lifecycleService,
  applyConsoleSettings,
  installServiceEngine,
  previewSqlEngineSwitch,
  switchSqlEngine,
  applyNginxSite,
  installControlPlaneSystemd,
  probeControlPlaneSystemd,
  getServiceMatrix,
  lifecycleServiceUnit,
  runSelfUpdate,
  upsertLetsEncryptRecord,
  listCertificatesView,
  dedupeCertificatesInStore,
  deleteCertificate,
  hardenDataDirPerms,
  ensureWebUiBuilt,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';
import { VERSION } from '../version.js';

export async function handleSystemRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // Defense Center / protection / geoip → routes/defense.ts (Wave C1)

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

  if (!url.pathname.startsWith('/api/v1/system/') && url.pathname !== '/api/v1/updates/self/apply') {
    return false;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/email/apply') {
    // applyEmailStack is fail-closed when installPackages without EXECUTE
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      installPackages?: boolean;
      domainId?: string;
    };
    const domain = data.domain ?? 'example.com';
    const result = await applyEmailStack({
      dataDir: ctx.dataDir,
      domain,
      host: ctx.host,
      installPackages: data.installPackages,
    });
    // Write-back apply status onto matching email domain record (durable)
    const applyStatus = {
      status: result.ok ? 'applied' : 'failed',
      ok: result.ok,
      at: new Date().toISOString(),
      written: result.written,
      notes: result.notes,
      actor: user.username,
    };
    const emailRows = ctx.db.snapshot.email_domains as Array<Record<string, unknown>>;
    const match = emailRows.find(
      (e) =>
        (data.domainId && e.id === data.domainId) ||
        String(e.domain ?? '').toLowerCase() === domain.toLowerCase(),
    );
    if (match) {
      match.apply_status = applyStatus.status;
      match.last_apply = { ...applyStatus, serviceStatus: result.serviceStatus };
      match.updated_at = applyStatus.at;
      ctx.db.persist();
      if (typeof match.id === 'string') {
        ctx.email.markApplyStatus(match.id, {
          ok: result.ok,
          notes: result.notes,
          serviceStatus: result.serviceStatus,
        });
      }
    } else {
      // still record standalone apply job under settings for visibility
      ctx.settings.set(
        `email.apply.${domain}`,
        JSON.stringify({ ...applyStatus, serviceStatus: result.serviceStatus }),
      );
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.email.apply',
      detail: { ...result, applyStatus, domainId: match?.id },
      ok: result.ok,
    });
    sendOpsResult(res, {
      ...result,
      applyStatus,
      domainId: match?.id ?? null,
      serviceStatus: result.serviceStatus,
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/ssl/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { domain?: string; email?: string; run?: boolean };
    const domain = data.domain ?? 'example.com';
    const email = data.email ?? 'admin@example.com';
    // Panel default: always attempt execution (run defaults true)
    const run = data.run !== false;
    const result = await applyLetsEncrypt({
      domain,
      email,
      host: ctx.host,
      run,
    });
    const certRow = upsertLetsEncryptRecord({
      db: ctx.db,
      domain,
      email,
      actor: user.username,
      ok: result.ok,
      run,
      executed: Boolean(result.executed && result.ok),
      commands: result.commands ?? [],
      notes: result.notes ?? [],
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.ssl.apply',
      detail: { ...result, certId: certRow.id, domain },
      ok: result.ok,
    });
    sendOpsResult(res, {
      ok: result.ok,
      executed: result.executed,
      blocked: result.blocked,
      blockReason: result.blockReason,
      blockMessage: result.blockMessage,
      notes: result.notes,
      steps: result.steps,
      certificate: certRow,
    });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/ssl/certificates') {
    ctx.auth.authenticate(getBearer(req));
    dedupeCertificatesInStore(ctx.db);
    sendJson(res, 200, { items: listCertificatesView(ctx.db, ctx.dataDir) });
    return true;
  }

  if (method === 'DELETE' && url.pathname.startsWith('/api/v1/system/ssl/certificates/')) {
    const user = ctx.auth.authenticate(getBearer(req));
    const idOrDomain = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const r = deleteCertificate(ctx.db, ctx.dataDir, idOrDomain);
    ctx.audit.append({
      actor: user.username,
      action: 'ssl.delete',
      resource: r.domain,
      detail: r,
      ok: r.ok,
    });
    sendOpsResult(res, r, { notFound: true });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/ssl/letsencrypt') {
    // Alias: prefer explicit execute flag
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      email?: string;
      execute?: boolean;
      run?: boolean;
    };
    const domain = data.domain ?? '';
    const email = data.email ?? `admin@${domain || 'example.com'}`;
    // Default execute from panel
    const run = data.execute !== false && data.run !== false;
    const result = await applyLetsEncrypt({ domain, email, host: ctx.host, run });
    const certRow = upsertLetsEncryptRecord({
      db: ctx.db,
      domain,
      email,
      actor: user.username,
      ok: result.ok,
      run,
      executed: Boolean(result.executed && result.ok),
      commands: result.commands ?? [],
      notes: result.notes ?? [],
    });
    sendOpsResult(res, {
      ok: result.ok,
      executed: result.executed,
      blocked: result.blocked,
      blockReason: result.blockReason,
      blockMessage: result.blockMessage,
      notes: result.notes,
      steps: result.steps,
      certificate: certRow,
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/php/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      docRoot?: string;
      phpVersion?: string;
      poolName?: string;
      enableSite?: boolean;
    };
    const result = await applyPhpHosting({
      dataDir: ctx.dataDir,
      domain: data.domain ?? 'php.local',
      docRoot: data.docRoot ?? `${ctx.dataDir}/www/php`,
      phpVersion: data.phpVersion ?? '8.2',
      poolName: data.poolName ?? 'yskphp',
      host: ctx.host,
      enableSite: data.enableSite,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.php.apply',
      detail: result,
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  // software + stack → routes/software.ts (Wave C3)

  // —— Professional service console (all engines) ——
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb|postgres|redis)\/console$/)) {
    ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb' | 'postgres' | 'redis';
    const consoleDto = await getServiceConsole(ctx.host, engine, ctx.db);
    sendJson(res, 200, consoleDto);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb|postgres|redis)\/console\/apply$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb' | 'postgres' | 'redis';
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { changes?: Record<string, string> };
    const result = await applyConsoleSettings({
      host: ctx.host,
      engine,
      changes: data.changes ?? {},
    });
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.console.apply`,
      detail: { ok: result.ok, applied: result.applied },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb|postgres|redis)\/lifecycle$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb' | 'postgres' | 'redis';
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { action?: string };
    const action = data.action as 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable';
    const result = await lifecycleService(ctx.host, engine, action);
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.lifecycle`,
      detail: { action, ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb|postgres|redis)\/install$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb' | 'postgres' | 'redis';
    // prefer console install for postgres (catalog); mysql/redis already had install routes
    if (engine === 'postgres' || engine === 'mysql' || engine === 'mariadb' || engine === 'redis') {
      const result = await installServiceEngine(ctx.host, engine, ctx.dataDir);
      ctx.audit.append({
        actor: user.username,
        action: `system.db.${engine}.install`,
        detail: { ok: result.ok, code: result.code },
        ok: result.ok,
      });
      sendOpsResult(res, result);
      return true;
    }
  }

  // —— SQL engine exclusive switch (MySQL XOR MariaDB) ——
  if (method === 'GET' && url.pathname === '/api/v1/system/db/sql-engine/switch-preview') {
    ctx.auth.authenticate(getBearer(req));
    const target = (url.searchParams.get('target') || '') as 'mysql' | 'mariadb';
    if (target !== 'mysql' && target !== 'mariadb') {
      sendJson(res, 400, { ok: false, message: 'target must be mysql|mariadb' });
      return true;
    }
    const preview = await previewSqlEngineSwitch({
      host: ctx.host,
      target,
      dataDir: ctx.dataDir,
    });
    sendJson(res, 200, preview);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/sql-engine/switch') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      target?: string;
      confirmPhrase?: string;
      acknowledgeExclusive?: boolean;
      migrateData?: boolean;
      rootPassword?: string;
    };
    const target = data.target as 'mysql' | 'mariadb';
    if (target !== 'mysql' && target !== 'mariadb') {
      sendJson(res, 400, { ok: false, message: 'target must be mysql|mariadb' });
      return true;
    }
    const result = await switchSqlEngine({
      host: ctx.host,
      dataDir: ctx.dataDir,
      target,
      confirmPhrase: String(data.confirmPhrase ?? ''),
      acknowledgeExclusive: data.acknowledgeExclusive === true,
      migrateData: data.migrateData !== false,
      rootPassword: typeof data.rootPassword === 'string' ? data.rootPassword : undefined,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.sql_engine.switch',
      detail: {
        target,
        ok: result.ok,
        code: result.code,
        dumpPath: result.dumpPath,
      },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  // —— MySQL / MariaDB engine ——
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/status$/)) {
    ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    sendJson(res, 200, await getSqlServiceView({ db: ctx.db, host: ctx.host, engine }));
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/settings$/)) {
    ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const settings = loadSqlSettings(ctx.db, engine);
    const status = await getSqlServiceView({ db: ctx.db, host: ctx.host, engine });
    sendJson(res, 200, { settings, status });
    return true;
  }
  if (method === 'PUT' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/settings$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const settings = saveSqlSettings(ctx.db, engine, data);
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.settings.save`,
      detail: { port: settings.port },
      ok: true,
    });
    sendJson(res, 200, { ok: true, settings });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/settings\/apply$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { settings?: Record<string, unknown>; restart?: boolean };
    const result = await applySqlServiceConfig({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
      engine,
      settings: data.settings as object,
      restart: data.restart !== false,
    });
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.settings.apply`,
      detail: { ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/db/postgres/status') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, await getPostgresServiceView({ db: ctx.db, host: ctx.host }));
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/db/postgres/settings') {
    ctx.auth.authenticate(getBearer(req));
    const settings = loadPostgresSettings(ctx.db);
    const status = await getPostgresServiceView({ db: ctx.db, host: ctx.host });
    sendJson(res, 200, { settings, status });
    return true;
  }
  if (method === 'PUT' && url.pathname === '/api/v1/system/db/postgres/settings') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const settings = savePostgresSettings(ctx.db, data);
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.postgres.settings.save',
      detail: { port: settings.port },
      ok: true,
    });
    sendJson(res, 200, { ok: true, settings });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/postgres/settings/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { settings?: Record<string, unknown>; restart?: boolean };
    const result = await applyPostgresServiceConfig({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
      settings: data.settings as object,
      restart: data.restart !== false,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.postgres.settings.apply',
      detail: { ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/install$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const result = await installDbEngine({
      host: ctx.host,
      engine,
      dataDir: ctx.dataDir,
    });
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.install`,
      detail: { ok: result.ok, blocked: result.blocked },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/start$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const result = await startDbEngine({ host: ctx.host, engine });
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.start`,
      detail: { ok: result.ok, code: result.code },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/unfreeze$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { confirm?: boolean };
    const result = await unfreezeDbEngine({
      host: ctx.host,
      engine,
      confirm: data.confirm === true,
    });
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.unfreeze`,
      detail: { ok: result.ok, code: result.code },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  // —— Redis service + browser ——
  if (method === 'GET' && url.pathname === '/api/v1/system/db/redis/status') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, await getRedisServiceView({ db: ctx.db, host: ctx.host }));
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/db/redis/settings') {
    ctx.auth.authenticate(getBearer(req));
    const settings = loadRedisSettings(ctx.db);
    const view = await getRedisServiceView({ db: ctx.db, host: ctx.host });
    sendJson(res, 200, { settings, status: view });
    return true;
  }
  if (method === 'PUT' && url.pathname === '/api/v1/system/db/redis/settings') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const settings = saveRedisSettings(ctx.db, data);
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.redis.settings.save',
      detail: { databases: settings.databases },
      ok: true,
    });
    sendJson(res, 200, { ok: true, settings });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/redis/settings/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { settings?: Record<string, unknown>; restart?: boolean };
    const result = await applyRedisServiceConfig({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
      settings: data.settings as object,
      restart: data.restart !== false,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.redis.settings.apply',
      detail: { ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/redis/install') {
    const user = ctx.auth.authenticate(getBearer(req));
    const result = await installRedisService({ host: ctx.host, dataDir: ctx.dataDir });
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.redis.install',
      detail: { ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/redis/start') {
    const user = ctx.auth.authenticate(getBearer(req));
    const result = await startRedisService(ctx.host);
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.redis.start',
      detail: { ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  // Content browser — must stay under /api/v1/system/* (handler gate below protection)
  if (method === 'GET' && url.pathname === '/api/v1/system/redis/keys') {
    ctx.auth.authenticate(getBearer(req));
    const db = Number(url.searchParams.get('db') ?? 0);
    const pattern = url.searchParams.get('pattern') ?? '*';
    const count = Number(url.searchParams.get('count') ?? 100);
    try {
      const result = await listRedisKeys({ host: ctx.host, db, pattern, count });
      sendOpsResult(res, result);
    } catch (e) {
      sendJson(res, 400, {
        ok: false,
        notes: [e instanceof Error ? e.message : 'list failed'],
        keys: [],
      });
    }
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/redis/key') {
    ctx.auth.authenticate(getBearer(req));
    const db = Number(url.searchParams.get('db') ?? 0);
    const key = url.searchParams.get('key') ?? '';
    try {
      const result = await getRedisKey({ host: ctx.host, db, key });
      sendOpsResult(res, result, { notFound: true });
    } catch (e) {
      sendJson(res, 400, { ok: false, notes: [e instanceof Error ? e.message : 'get failed'] });
    }
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/redis/key') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      db?: number;
      key?: string;
      value?: string;
      ttl?: number;
    };
    try {
      const result = await setRedisString({
        host: ctx.host,
        db: data.db,
        key: String(data.key ?? ''),
        value: String(data.value ?? ''),
        ttl: data.ttl,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'redis.key.set',
        detail: { key: data.key, db: data.db, ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, result);
    } catch (e) {
      sendJson(res, 400, {
        ok: false,
        notes: [e instanceof Error ? e.message : 'set failed'],
      });
    }
    return true;
  }
  if (method === 'DELETE' && url.pathname === '/api/v1/system/redis/key') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { db?: number; key?: string };
    try {
      const result = await deleteRedisKey({
        host: ctx.host,
        db: data.db,
        key: String(data.key ?? ''),
      });
      ctx.audit.append({
        actor: user.username,
        action: 'redis.key.del',
        detail: { key: data.key, db: data.db, ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, result);
    } catch (e) {
      sendJson(res, 400, {
        ok: false,
        notes: [e instanceof Error ? e.message : 'del failed'],
      });
    }
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
  // firewall + fail2ban → routes/firewall.ts (Wave C2)

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

  if (method === 'POST' && url.pathname === '/api/v1/system/nginx/purge-cache') {
    const user = ctx.auth.authenticate(getBearer(req));
    const { purgeNginxCache } = await import('@ysk/core');
    const r = await purgeNginxCache({ host: ctx.host });
    ctx.audit.append({
      actor: user.username,
      action: 'system.nginx.purge_cache',
      detail: r,
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/db/dump') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      engine?: 'mysql' | 'mariadb' | 'postgres';
      dbName?: string;
      username?: string;
      password?: string;
    };
    const { dumpSqlDatabase } = await import('@ysk/core');
    const r = await dumpSqlDatabase({
      host: ctx.host,
      dataDir: ctx.dataDir,
      engine: data.engine ?? 'mysql',
      dbName: data.dbName ?? '',
      username: data.username,
      password: data.password,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'db.dump',
      detail: { engine: data.engine, dbName: data.dbName, ok: r.ok },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/db/dumps') {
    ctx.auth.authenticate(getBearer(req));
    const { listSqlDumps } = await import('@ysk/core');
    const engine = url.searchParams.get('engine') as 'mysql' | 'mariadb' | 'postgres' | null;
    sendJson(res, 200, { items: listSqlDumps(ctx.dataDir, engine || undefined) });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/import') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      engine?: 'mysql' | 'mariadb' | 'postgres';
      dbName?: string;
      sqlPath?: string;
      name?: string;
      username?: string;
      password?: string;
    };
    const { importSqlDatabase, listSqlDumps } = await import('@ysk/core');
    let sqlPath = data.sqlPath ?? '';
    if (!sqlPath && data.name) {
      const found = listSqlDumps(ctx.dataDir, data.engine).find((d) => d.name === data.name);
      sqlPath = found?.path ?? '';
    }
    const r = await importSqlDatabase({
      host: ctx.host,
      engine: data.engine ?? 'mysql',
      dbName: data.dbName ?? '',
      sqlPath,
      username: data.username,
      password: data.password,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'db.import',
      detail: { engine: data.engine, dbName: data.dbName, ok: r.ok },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/nginx/site') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      serverName?: string;
      upstream?: string;
      ssl?: boolean;
      reload?: boolean;
    };
    const result = await applyNginxSite({
      dataDir: ctx.dataDir,
      serverName: data.serverName ?? 'app.local',
      upstream: data.upstream ?? 'http://127.0.0.1:3000',
      ssl: data.ssl,
      host: ctx.host,
      reload: data.reload,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.nginx.site',
      detail: result,
      ok: Boolean(result.ok),
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/systemd/install') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { enable?: boolean };
    const cliPath = process.argv[1] ?? 'ysk-server';
    const result = await installControlPlaneSystemd({
      dataDir: ctx.dataDir,
      cliPath,
      host: ctx.host,
      enable: data.enable,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.systemd.install',
      detail: result,
      ok: Boolean(result.ok),
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/systemd/status') {
    ctx.auth.authenticate(getBearer(req));
    const status = await probeControlPlaneSystemd(ctx.host, ctx.dataDir);
    sendJson(res, 200, status);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/services/matrix') {
    ctx.auth.authenticate(getBearer(req));
    const matrix = await getServiceMatrix(ctx.host);
    sendJson(res, 200, matrix);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/services/lifecycle') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      unit?: string;
      action?: 'start' | 'stop' | 'restart' | 'reload';
    };
    if (!data.unit || !data.action) {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n0458')] });
      return true;
    }
    const result = await lifecycleServiceUnit(ctx.host, data.unit, data.action);
    ctx.audit.append({
      actor: user.username,
      action: 'system.services.lifecycle',
      detail: { unit: data.unit, action: data.action, ...result },
      ok: Boolean(result.ok),
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/updates/self/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { apply?: boolean; latest?: string };
    // Panel always applies unless explicitly dry-run
    const apply = data.apply !== false;
    const result = await runSelfUpdate({
      currentVersion: VERSION,
      host: ctx.host,
      apply,
      latestOverride: data.latest,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'update.self.apply',
      detail: {
        applied: result.applied,
        ok: result.ok,
        checked: result.checked,
        updateAvailable: result.updateAvailable,
        channel: result.channel,
      },
      ok: result.ok,
    });
    // Honest HTTP: do not 200 when apply failed or channel check failed
    sendJson(res, result.ok ? 200 : result.checked === false ? 502 : 422, result);
    return true;
  }

  // —— Control-plane export + managed nginx + rebuild ——
  // Must live here: handleSystemRoutes is invoked before inline http-server routes.
  if (method === 'GET' && url.pathname === '/api/v1/system/export') {
    ctx.auth.authenticate(getBearer(req));
    const { exportControlPlaneSnapshot } = await import('@ysk/core');
    sendJson(res, 200, exportControlPlaneSnapshot(ctx.db));
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/exports') {
    ctx.auth.authenticate(getBearer(req));
    const { listControlPlaneExports } = await import('@ysk/core');
    sendJson(res, 200, { items: listControlPlaneExports(ctx.dataDir) });
    return true;
  }
  if (method === 'GET' && url.pathname.startsWith('/api/v1/system/exports/')) {
    ctx.auth.authenticate(getBearer(req));
    const name = decodeURIComponent(url.pathname.split('/').pop() || '');
    const { resolveExportFile } = await import('@ysk/core');
    const { createReadStream, existsSync } = await import('node:fs');
    const r = resolveExportFile(ctx.dataDir, name);
    if (!r.ok || !existsSync(r.path)) {
      sendJson(res, 404, { ok: false, notes: r.ok ? [tl('notes.auto.n0496')] : r.notes });
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    createReadStream(r.path).pipe(res);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/managed-nginx') {
    ctx.auth.authenticate(getBearer(req));
    const { listManagedNginxDetailed } = await import('@ysk/core');
    const { listWithQuery } = await import('../http/list-response.js');
    const all = listManagedNginxDetailed(ctx.dataDir) as Array<Record<string, unknown>>;
    const { items, meta } = listWithQuery(url, all, {
      text: (n) => [
        String(n.name ?? n.file ?? n.id ?? ''),
        String(n.domain ?? n.serverName ?? ''),
        String(n.path ?? ''),
      ],
    });
    sendJson(res, 200, { items, meta });
    return true;
  }
  if (method === 'GET' && url.pathname.startsWith('/api/v1/system/managed-nginx/')) {
    ctx.auth.authenticate(getBearer(req));
    const name = decodeURIComponent(url.pathname.split('/').pop() || '');
    const { readManagedNginxConf } = await import('@ysk/core');
    const r = readManagedNginxConf(ctx.dataDir, name);
    sendOpsResult(res, r, { notFound: true });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/rebuild') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      syncNginx?: boolean;
      writeExport?: boolean;
      dryRun?: boolean;
    };
    const { rebuildManagedConfigs } = await import('@ysk/core');
    const r = await rebuildManagedConfigs({
      dataDir: ctx.dataDir,
      host: ctx.host,
      db: ctx.db,
      syncNginx: data.syncNginx,
      writeExport: data.writeExport !== false,
      dryRun: data.dryRun === true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.rebuild',
      detail: {
        ok: r.ok,
        mode: r.mode,
        blocked: r.blocked,
        dryRun: r.dryRun,
        confCount: r.nginxConfs?.length,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  // —— Host full migrate (整機遷移) ——
  if (method === 'POST' && url.pathname === '/api/v1/system/migrate/inventory') {
    ctx.auth.authenticate(getBearer(req));
    const { migrateInventory } = await import('@ysk/core');
    const r = await migrateInventory({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      yskVersion: VERSION,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/migrate/jobs') {
    ctx.auth.authenticate(getBearer(req));
    const { listMigrateJobs } = await import('@ysk/core');
    sendJson(res, 200, { ok: true, jobs: listMigrateJobs(ctx.dataDir) });
    return true;
  }

  if (method === 'GET' && url.pathname.startsWith('/api/v1/system/migrate/jobs/')) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/').pop() || '';
    const { loadMigrateJob } = await import('@ysk/core');
    const job = loadMigrateJob(ctx.dataDir, id);
    if (!job) {
      sendJson(res, 404, { ok: false, notes: [tl('notes.auto.n0853')] });
      return true;
    }
    sendJson(res, 200, { ok: true, job });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/migrate/jobs') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      target?: string;
      port?: number;
      identityId?: string;
      identityFile?: string;
      /** one-shot; never stored */
      password?: string;
      maintenanceAccepted?: boolean;
      forceWipeTarget?: boolean;
      targetDataDir?: string;
      dryRun?: boolean;
      skipRemotePost?: boolean;
      jobId?: string;
      execute?: boolean;
    };
    const target = (data.target || '').trim();
    if (!target && !data.jobId) {
      sendJson(res, 400, {
        ok: false,
        notes: [tl('notes.auto.n1573')],
      });
      return true;
    }
    if (!data.execute && !data.dryRun) {
      sendJson(res, 403, {
        ok: false,
        blocked: true,
        notes: [tl('notes.auto.n1544')],
      });
      return true;
    }
    if (data.execute && !ctx.host.executeEnabled()) {
      sendOpsResult(res, {
        ok: false,
        blocked: true,
        requiresExecute: true,
        notes: [tl('notes.auto.n0525')],
      });
      return true;
    }

    const { runSourceMigrateHost, loadMigrateJob } = await import('@ysk/core');
    type Auth =
      | { kind: 'identity'; privateKeyPath: string }
      | { kind: 'identityId'; dataDir: string; identityId: string }
      | { kind: 'password'; password: string }
      | { kind: 'agent' };
    let auth: Auth = { kind: 'agent' };
    let passwordForTempKey: string | undefined;
    if (data.identityFile) {
      auth = { kind: 'identity', privateKeyPath: data.identityFile };
    } else if (data.identityId) {
      auth = {
        kind: 'identityId',
        dataDir: ctx.dataDir,
        identityId: data.identityId,
      };
    } else if (data.password) {
      passwordForTempKey = data.password;
      auth = { kind: 'agent' };
    }

    let targetStr = target;
    if (!targetStr && data.jobId) {
      const prev = loadMigrateJob(ctx.dataDir, data.jobId);
      if (prev?.target) {
        targetStr = `${prev.target.user}@${prev.target.host}`;
        if (!data.port && prev.target.port) data.port = prev.target.port;
      }
    }
    if (!targetStr) {
      sendJson(res, 400, {
        ok: false,
        notes: [tl('notes.auto.n1574')],
      });
      return true;
    }

    const r = await runSourceMigrateHost({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      target: targetStr,
      port: data.port,
      auth,
      passwordForTempKey,
      maintenanceAccepted: data.maintenanceAccepted === true || data.execute === true,
      forceWipeTarget: data.forceWipeTarget === true,
      targetDataDir: data.targetDataDir,
      dryRun: data.dryRun === true,
      remotePost: data.skipRemotePost !== true,
      yskVersion: VERSION,
      jobId: data.jobId,
    });

    ctx.audit.append({
      actor: user.username,
      action: 'system.migrate.host',
      detail: {
        ok: r.ok,
        blocked: r.blocked,
        jobId: r.job?.id,
        target: target || undefined,
        dryRun: data.dryRun === true,
        phase: r.job?.phase,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/migrate/post') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { jobId?: string };
    if (!data.jobId) {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n1563')] });
      return true;
    }
    if (!ctx.host.executeEnabled()) {
      sendOpsResult(res, {
        ok: false,
        blocked: true,
        requiresExecute: true,
        notes: [tl('notes.auto.n0332')],
      });
      return true;
    }
    const { runLocalMigratePost } = await import('@ysk/core');
    const r = await runLocalMigratePost({
      host: ctx.host,
      dataDir: ctx.dataDir,
      jobId: data.jobId,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.migrate.post',
      detail: { ok: r.ok, jobId: data.jobId },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }



  if (method === 'POST' && url.pathname === '/api/v1/system/readiness/fix') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { action?: string };
    const action = String(data.action ?? '').trim();
    if (!action) {
      sendJson(res, 400, { ok: false, notes: ['action required'] });
      return true;
    }
    if (action === 'harden-datadir') {
      const result = hardenDataDirPerms(ctx.dataDir);
      ctx.audit.append({
        actor: user.username,
        action: 'system.readiness.fix',
        detail: {
          fixAction: action,
          path: result.path,
          before: result.before,
          after: result.after,
          notes: result.notes,
        },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        action,
        path: result.path,
        before: result.before,
        after: result.after,
        notes: result.notes,
      });
      return true;
    }
    if (action === 'build-web-ui') {
      const result = await ensureWebUiBuilt({ dataDir: ctx.dataDir });
      ctx.audit.append({
        actor: user.username,
        action: 'system.readiness.fix',
        detail: {
          fixAction: action,
          path: result.path,
          notes: result.notes,
          codes: result.codes,
        },
        ok: result.ok,
      });
      // Prefer localized operator message when monorepo/package missing
      const notes =
        result.ok || !result.codes?.includes('NO_MONOREPO')
          ? result.notes
          : [
              tl('readiness.itemWebBuildManual'),
              ...result.notes,
            ];
      sendOpsResult(res, {
        ok: result.ok,
        action,
        path: result.path,
        notes,
        codes: result.codes,
      });
      return true;
    }
    sendJson(res, 400, {
      ok: false,
      notes: [`unknown readiness fix action: ${action}`],
      action,
    });
    return true;
  }


  return false;
}