/**
 * System apply + protection routes extracted for modularity.
 * (Main router still may handle some; this owns /api/v1/system/* and protection probe helpers.)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { SystemRole } from '@ysk/shared';
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
  probeAllSoftware,
  installSoftware,
  installSoftwareBatch,
  installForFeature,
  getSoftware,
  installDbEngine,
  startDbEngine,
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
  applyFirewall,
  applyFail2ban,
  probeFirewallStatus,
  probeFail2banStatus,
  applyNginxSite,
  installControlPlaneSystemd,
  probeControlPlaneSystemd,
  getServiceMatrix,
  lifecycleServiceUnit,
  runProtectionProbes,
  getPlaybook,
  runSelfUpdate,
  upsertLetsEncryptRecord,
  listCertificatesView,
  dedupeCertificatesInStore,
  deleteCertificate,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { applyProtection } from '../app-context.js';
import { getBearer, readBody, sendJson } from '../http/util.js';
import { VERSION } from '../version.js';

export async function handleSystemRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // Files handled elsewhere; system + protection here
  if (method === 'POST' && url.pathname === '/api/v1/protection/probe') {
    const user = ctx.auth.authenticate(getBearer(req));
    const probe = await ctx.runAutoProtection();
    ctx.audit.append({
      actor: user.username,
      action: 'protection.probe',
      detail: probe,
      ok: true,
    });
    sendJson(res, 200, probe);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/protection/status') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, {
      protection: ctx.protection,
      scheduler: ctx.scheduler.list(),
      lastProbe: ctx.settings.getJson('last_protection_probe') ?? null,
      lastInventory: ctx.settings.getJson('last_inventory') ?? null,
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/protection/emergency') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { playbookId?: string };
    const probe = await runProtectionProbes({
      requestCountLastMinute: ctx.requestHits.length,
    });
    applyProtection(ctx, probe.protection);
    const playbookId = data.playbookId ?? probe.suggestedPlaybooks[0]?.id ?? 'local-llm-ops-only';
    let runResult: unknown = null;
    try {
      const pb = getPlaybook(playbookId);
      const task = await ctx.ai.create(`emergency:${pb.id}`, user.username, false);
      task.steps = pb.steps.map((s) => {
        const ev = ctx.allowlist.evaluate(s.tool);
        return {
          id: randomUUID(),
          tool: s.tool,
          args: s.args,
          risk: ev.risk,
          requiresApproval: ev.requiresApproval,
          status: 'planned' as const,
        };
      });
      const tasks = ctx.db.snapshot.ai_tasks as unknown as Array<{ id: string }>;
      const idx = tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) tasks[idx] = task as never;
      ctx.db.persist();
      ctx.ai.approve(task.id, user.username);
      runResult = await ctx.ai.execute(task.id, user.username, user.roles as SystemRole[]);
    } catch (e) {
      runResult = { error: e instanceof Error ? e.message : String(e), playbookId };
    }
    sendJson(res, 200, { probe, playbookId, run: runResult });
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
    sendJson(res, result.ok || !data.installPackages ? 200 : 422, {
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
    sendJson(res, result.ok ? 200 : 422, {
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
    sendJson(res, r.ok ? 200 : 404, r);
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
    sendJson(res, result.ok ? 200 : 422, {
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

  // —— Unified one-click software install ——
  if (method === 'GET' && url.pathname === '/api/v1/system/software') {
    ctx.auth.authenticate(getBearer(req));
    const feature = url.searchParams.get('feature') ?? undefined;
    const items = await probeAllSoftware(ctx.host, feature);
    const missing = items.filter((i) => !i.installed);
    sendJson(res, 200, {
      items,
      missing,
      ready: missing.length === 0,
    });
    return true;
  }

  if (
    method === 'GET' &&
    url.pathname.match(/^\/api\/v1\/system\/software\/[^/]+$/) &&
    !url.pathname.endsWith('/install')
  ) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/').pop()!;
    const spec = getSoftware(id);
    if (!spec) {
      sendJson(res, 404, { ok: false, message: 'unknown software' });
      return true;
    }
    const items = await probeAllSoftware(ctx.host);
    const status = items.find((i) => i.id === id);
    sendJson(res, 200, {
      status,
      spec: { id: spec.id, title: spec.title, packages: spec.aptPackages },
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/software/install') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ids?: string[]; feature?: string };
    let result: Record<string, unknown>;
    if (data.feature) {
      result = (await installForFeature({
        host: ctx.host,
        feature: data.feature,
        dataDir: ctx.dataDir,
      })) as unknown as Record<string, unknown>;
    } else {
      const ids = data.ids ?? [];
      result = (await installSoftwareBatch({
        host: ctx.host,
        ids,
        dataDir: ctx.dataDir,
      })) as unknown as Record<string, unknown>;
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.software.install',
      detail: { feature: data.feature, ids: data.ids, ok: result.ok },
      ok: Boolean(result.ok),
    });
    sendJson(res, result.ok ? 200 : 422, result);
    return true;
  }

  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/software\/[^/]+\/install$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const result = await installSoftware({
      host: ctx.host,
      id,
      dataDir: ctx.dataDir,
      enableUnits: true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.software.install.one',
      detail: { id, ok: result.ok },
      ok: result.ok,
    });
    sendJson(res, result.ok ? 200 : 422, result);
    return true;
  }

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
    sendJson(res, result.ok ? 200 : 422, result);
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
    sendJson(res, result.ok ? 200 : 422, result);
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
        detail: { ok: result.ok },
        ok: result.ok,
      });
      sendJson(res, result.ok ? 200 : 422, result);
      return true;
    }
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
    sendJson(res, result.ok ? 200 : 422, result);
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
    sendJson(res, result.ok ? 200 : 422, result);
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
    sendJson(res, result.ok ? 200 : 422, result);
    return true;
  }

  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/start$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const result = await startDbEngine({ host: ctx.host, engine });
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.start`,
      detail: { ok: result.ok },
      ok: result.ok,
    });
    sendJson(res, result.ok ? 200 : 422, result);
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
    sendJson(res, result.ok ? 200 : 422, result);
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
    sendJson(res, result.ok ? 200 : 422, result);
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
    sendJson(res, result.ok ? 200 : 422, result);
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
      sendJson(res, result.ok ? 200 : 422, result);
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
      sendJson(res, result.ok ? 200 : 404, result);
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
      sendJson(res, result.ok ? 200 : 422, result);
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
      sendJson(res, result.ok ? 200 : 422, result);
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
    sendJson(res, result.ok ? 200 : 422, result);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/firewall/status') {
    ctx.auth.authenticate(getBearer(req));
    const status = await probeFirewallStatus(ctx.host);
    sendJson(res, 200, status);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      allowSmtp?: boolean;
      apply?: boolean;
      extraTcpPorts?: number[];
    };
    const result = await applyFirewall({
      host: ctx.host,
      dataDir: ctx.dataDir,
      allowSmtp: data.allowSmtp,
      apply: data.apply,
      extraTcpPorts: data.extraTcpPorts,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.apply',
      detail: result,
      ok: result.ok,
    });
    sendJson(res, result.ok || !data.apply ? 200 : 422, result);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/fail2ban/status') {
    ctx.auth.authenticate(getBearer(req));
    const status = await probeFail2banStatus(ctx.host);
    sendJson(res, 200, status);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/fail2ban/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { apply?: boolean; jails?: string[] };
    const result = await applyFail2ban({
      dataDir: ctx.dataDir,
      host: ctx.host,
      apply: data.apply,
      jails: data.jails,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.fail2ban.apply',
      detail: result,
      ok: result.ok,
    });
    sendJson(res, result.ok || !data.apply ? 200 : 422, result);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/fail2ban/banned') {
    ctx.auth.authenticate(getBearer(req));
    const jail = url.searchParams.get('jail') ?? undefined;
    const { fail2banBannedIps } = await import('@ysk/core');
    sendJson(res, 200, await fail2banBannedIps(ctx.host, jail || undefined));
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/fail2ban/unban') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { jail?: string; ip?: string };
    const { fail2banUnban } = await import('@ysk/core');
    const r = await fail2banUnban(ctx.host, data.jail ?? 'sshd', data.ip ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'system.fail2ban.unban',
      detail: data,
      ok: r.ok,
    });
    sendJson(res, r.ok ? 200 : 422, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/fail2ban/ignoreip') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ip?: string; action?: 'add' | 'remove' };
    const { fail2banIgnoreIp } = await import('@ysk/core');
    const r = await fail2banIgnoreIp(
      ctx.host,
      ctx.dataDir,
      data.ip ?? '',
      data.action ?? 'add',
    );
    ctx.audit.append({
      actor: user.username,
      action: 'system.fail2ban.ignoreip',
      detail: data,
      ok: r.ok,
    });
    sendJson(res, r.ok ? 200 : 422, r);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/host-identity') {
    ctx.auth.authenticate(getBearer(req));
    const hn = await ctx.host.runCommand(['hostname'], { timeoutMs: 3_000 });
    const tz = await ctx.host.runCommand(['timedatectl', 'show', '-p', 'Timezone', '--value'], {
      timeoutMs: 5_000,
    });
    sendJson(res, 200, {
      hostname: (hn.stdout || '').trim() || null,
      timezone: (tz.stdout || '').trim() || null,
      executeEnabled: ctx.host.executeEnabled(),
      isRoot: ctx.host.isRoot(),
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/host-identity') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { hostname?: string; timezone?: string };
    const notes: string[] = [];
    if (!ctx.host.executeEnabled() || !ctx.host.isRoot()) {
      sendJson(res, 422, {
        ok: false,
        blocked: true,
        notes: ['無法變更主機名稱／時區：需要系統變更權限與管理員'],
      });
      return true;
    }
    if (data.hostname?.trim()) {
      const r = await ctx.host.runCommand(['hostnamectl', 'set-hostname', data.hostname.trim()], {
        timeoutMs: 10_000,
      });
      notes.push(
        r.exitCode === 0
          ? `hostname → ${data.hostname.trim()}`
          : `hostname 失敗: ${r.stderr || r.stdout}`,
      );
    }
    if (data.timezone?.trim()) {
      const r = await ctx.host.runCommand(['timedatectl', 'set-timezone', data.timezone.trim()], {
        timeoutMs: 10_000,
      });
      notes.push(
        r.exitCode === 0
          ? `timezone → ${data.timezone.trim()}`
          : `timezone 失敗: ${r.stderr || r.stdout}`,
      );
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.host_identity',
      detail: data,
      ok: true,
    });
    sendJson(res, 200, { ok: true, notes });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/nginx/purge-cache') {
    const user = ctx.auth.authenticate(getBearer(req));
    const notes: string[] = [];
    if (!ctx.host.executeEnabled()) {
      sendJson(res, 422, {
        ok: false,
        blocked: true,
        notes: ['無法 purge：未開啟系統變更權限'],
      });
      return true;
    }
    // Best-effort: remove common cache dirs + reload
    const r = await ctx.host.runCommand(
      [
        'bash',
        '-c',
        'rm -rf /var/cache/nginx/* /var/lib/nginx/cache/* 2>/dev/null; nginx -t && systemctl reload nginx; echo done',
      ],
      { timeoutMs: 30_000 },
    );
    notes.push(r.exitCode === 0 ? '已嘗試清除 nginx cache 並 reload' : `失敗: ${r.stderr || r.stdout}`);
    ctx.audit.append({
      actor: user.username,
      action: 'system.nginx.purge_cache',
      detail: { exit: r.exitCode },
      ok: r.exitCode === 0,
    });
    sendJson(res, r.exitCode === 0 ? 200 : 422, { ok: r.exitCode === 0, notes });
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
    sendJson(res, r.ok ? 200 : 422, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/db/dumps') {
    ctx.auth.authenticate(getBearer(req));
    const { listSqlDumps } = await import('@ysk/core');
    const engine = url.searchParams.get('engine') as 'mysql' | 'mariadb' | 'postgres' | null;
    sendJson(res, 200, { items: listSqlDumps(ctx.dataDir, engine || undefined) });
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
    sendJson(res, result.ok ? 200 : 422, result);
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
    sendJson(res, result.ok ? 200 : 422, result);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/systemd/status') {
    ctx.auth.authenticate(getBearer(req));
    const status = await probeControlPlaneSystemd(ctx.host);
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
      sendJson(res, 400, { ok: false, notes: ['unit 與 action 必填'] });
      return true;
    }
    const result = await lifecycleServiceUnit(ctx.host, data.unit, data.action);
    ctx.audit.append({
      actor: user.username,
      action: 'system.services.lifecycle',
      detail: { unit: data.unit, action: data.action, ...result },
      ok: Boolean(result.ok),
    });
    sendJson(res, result.ok ? 200 : 422, result);
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
      detail: result,
      ok: result.applied || !apply,
    });
    sendJson(res, 200, result);
    return true;
  }

  return false;
}
