import { tl } from '@ysk/shared';
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
  listStackPlans,
  listStackBundles,
  getStackStatus,
  installStack,
  uninstallStack,
  scanStack,
  expandComponents,
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
  applyFirewall,
  applyFail2ban,
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
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';
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

  // —— Defense Center (DDoS / attack protection) ——
  if (method === 'GET' && url.pathname === '/api/v1/defense/status') {
    ctx.auth.authenticate(getBearer(req));
    const { getDefenseStatus } = await import('@ysk/core');
    const status = await getDefenseStatus({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      requestCountLastMinute: ctx.requestHits?.length ?? 0,
    });
    sendJson(res, 200, status);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/probe') {
    const user = ctx.auth.authenticate(getBearer(req));
    const { getDefenseStatus } = await import('@ysk/core');
    await ctx.runAutoProtection();
    const status = await getDefenseStatus({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      requestCountLastMinute: ctx.requestHits?.length ?? 0,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'defense.probe',
      detail: { threatLevel: status.threatLevel, score: status.score },
      ok: true,
    });
    sendJson(res, 200, status);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/preset') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      preset?: string;
      apply?: boolean;
      confirm?: string;
    };
    const { applyDefensePreset } = await import('@ysk/core');
    const preset = (data.preset ?? 'daily') as
      | 'daily'
      | 'hardened'
      | 'under_attack'
      | 'emergency';
    const r = await applyDefensePreset({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      preset,
      apply: data.apply !== false,
      confirm: data.confirm,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'defense.preset',
      detail: { preset, ok: r.ok, applied: r.applied },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/defense/bans') {
    ctx.auth.authenticate(getBearer(req));
    const { listDefenseBans } = await import('@ysk/core');
    const { listWithQuery } = await import('../http/list-response.js');
    const r = await listDefenseBans({ host: ctx.host, db: ctx.db });
    const { items, meta } = listWithQuery(url, r.items, {
      text: (b) => [b.ip, b.source, b.jail ?? '', b.reason ?? ''],
      predicates: {
        source: (b, v) => b.source === v,
      },
      facetOf: {
        source: (b) => b.source,
      },
    }, { enums: { source: ['fail2ban', 'panel', 'ufw', 'auto'] } });
    sendJson(res, 200, { items, notes: r.notes, meta });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/stack/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { execute?: boolean };
    const { applyDefenseStack } = await import('@ysk/core');
    const r = await applyDefenseStack({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      execute: data.execute !== false,
      actor: user.username,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'defense.stack_apply',
      detail: { steps: r.steps, executed: r.executed },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/ban') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      ip?: string;
      reason?: string;
      method?: 'fail2ban' | 'ufw' | 'both';
      jail?: string;
    };
    const { defenseBanIp } = await import('@ysk/core');
    const r = await defenseBanIp({
      host: ctx.host,
      db: ctx.db,
      ip: data.ip ?? '',
      reason: data.reason,
      method: data.method,
      jail: data.jail,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'defense.ban',
      detail: { ip: data.ip, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/unban') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      ip?: string;
      method?: 'fail2ban' | 'ufw' | 'both';
      jail?: string;
    };
    const { defenseUnbanIp } = await import('@ysk/core');
    const r = await defenseUnbanIp({
      host: ctx.host,
      db: ctx.db,
      ip: data.ip ?? '',
      method: data.method,
      jail: data.jail,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'defense.unban',
      detail: { ip: data.ip, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/defense/timeline') {
    ctx.auth.authenticate(getBearer(req));
    const hours = Number(url.searchParams.get('hours') ?? '24') || 24;
    const { listDefenseTimeline } = await import('@ysk/core');
    const { listWithQuery } = await import('../http/list-response.js');
    const all = listDefenseTimeline(ctx.db, hours);
    const { items, meta } = listWithQuery(
      url,
      all,
      {
        text: (e) => [e.kind, e.title, e.detail ?? '', e.at],
        predicates: {
          kind: (e, v) => e.kind === v,
        },
        facetOf: {
          kind: (e) => e.kind,
        },
      },
      { freeFilters: ['kind'] },
    );
    sendJson(res, 200, { items, meta, hours });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/defense/suspects') {
    ctx.auth.authenticate(getBearer(req));
    const { listSuspectIps } = await import('@ysk/core');
    const { listWithQuery } = await import('../http/list-response.js');
    const r = await listSuspectIps({ host: ctx.host, db: ctx.db, dataDir: ctx.dataDir });
    const { items, meta } = listWithQuery(url, r.items, {
      text: (s) => [s.ip, String(s.hits ?? ''), String(s.score ?? '')],
    });
    sendJson(res, 200, { items, notes: r.notes, meta });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/ban-batch') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      ips?: string[];
      reason?: string;
      method?: 'fail2ban' | 'ufw' | 'both';
    };
    const { defenseBanBatch } = await import('@ysk/core');
    const r = await defenseBanBatch({
      host: ctx.host,
      db: ctx.db,
      ips: data.ips ?? [],
      reason: data.reason,
      method: data.method,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'defense.ban_batch',
      detail: { count: data.ips?.length, ok: r.ok, blocked: r.blocked },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/defense/auto-ban') {
    ctx.auth.authenticate(getBearer(req));
    const { loadAutoBanPolicy, countAutoBansLastHour } = await import('@ysk/core');
    const policy = loadAutoBanPolicy(ctx.db);
    sendJson(res, 200, {
      ...policy,
      autoBansLastHour: countAutoBansLastHour(policy),
    });
    return true;
  }
  if (method === 'PUT' && url.pathname === '/api/v1/defense/auto-ban') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const { updateAutoBanPolicy, countAutoBansLastHour } = await import('@ysk/core');
    const policy = updateAutoBanPolicy(ctx.db, {
      enabled: data.enabled as boolean | undefined,
      mode: data.mode as 'off' | 'soft' | 'normal' | 'aggressive' | undefined,
      method: data.method as 'fail2ban' | 'ufw' | 'both' | undefined,
      cooldownMinutes: data.cooldownMinutes as number | undefined,
      maxAutoBansPerHour: data.maxAutoBansPerHour as number | undefined,
      whitelist: data.whitelist as string[] | undefined,
      pausedReason: data.pausedReason === null ? undefined : (data.pausedReason as string | undefined),
    });
    ctx.audit.append({
      actor: user.username,
      action: 'defense.auto_ban.update',
      detail: { enabled: policy.enabled, mode: policy.mode },
      ok: true,
    });
    sendJson(res, 200, {
      ...policy,
      autoBansLastHour: countAutoBansLastHour(policy),
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/whitelist') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ip?: string; action?: 'add' | 'remove' };
    const {
      loadAutoBanPolicy,
      updateAutoBanPolicy,
      updateDefenseAutomation,
      loadDefenseAutomation,
      syncWhitelistToFail2banIgnore,
    } = await import('@ysk/core');
    const cur = loadAutoBanPolicy(ctx.db);
    const ip = (data.ip ?? '').trim();
    if (!ip) {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n1562')] });
      return true;
    }
    let whitelist = [...cur.whitelist];
    if (data.action === 'remove') {
      whitelist = whitelist.filter((w) => w !== ip);
    } else if (!whitelist.includes(ip)) {
      whitelist.unshift(ip);
      whitelist = whitelist.slice(0, 200);
    }
    const policy = updateAutoBanPolicy(ctx.db, { whitelist });
    // Keep automation autoBan.whitelist in lockstep (avoid dual-source drift)
    try {
      const auto = loadDefenseAutomation(ctx.db);
      updateDefenseAutomation(ctx.db, {
        autoBan: { ...auto.autoBan, whitelist },
      });
      if (auto.autoBan.syncFail2banIgnoreip !== false) {
        syncWhitelistToFail2banIgnore(ctx.dataDir, whitelist);
      }
    } catch {
      /* best-effort */
    }
    ctx.audit.append({
      actor: user.username,
      action: 'defense.whitelist',
      detail: { ip, action: data.action ?? 'add' },
      ok: true,
    });
    sendJson(res, 200, { ok: true, whitelist: policy.whitelist });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/auto-ban/tick') {
    const user = ctx.auth.authenticate(getBearer(req));
    const { runDefenseAutomationTick } = await import('@ysk/core');
    const r = await runDefenseAutomationTick({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      requestCountLastMinute: ctx.requestHits?.length ?? 0,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'defense.automation.tick',
      detail: {
        banned: r.banned.length,
        presetChanged: r.presetChanged,
        score: r.score,
        ok: r.ok,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/defense/automation') {
    ctx.auth.authenticate(getBearer(req));
    const {
      loadDefenseAutomation,
      getAutomationMechanismRows,
      countAutoBansLastHour,
      loadAutoBanPolicy,
    } = await import('@ysk/core');
    const automation = loadDefenseAutomation(ctx.db);
    const legacy = loadAutoBanPolicy(ctx.db);
    const job = ctx.scheduler.get?.('defense-auto-ban') ??
      ctx.scheduler.list().find((j) => j.id === 'defense-auto-ban');
    sendJson(res, 200, {
      automation,
      mechanisms: getAutomationMechanismRows(),
      autoBansLastHour: countAutoBansLastHour(legacy),
      scheduler: job
        ? {
            intervalMs: job.intervalMs,
            lastRunAt: job.lastRunAt,
            nextRunAt: job.nextRunAt,
            running: job.running,
          }
        : null,
      hasCfToken: Boolean(process.env.CF_API_TOKEN?.trim()),
    });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/defense/intel') {
    ctx.auth.authenticate(getBearer(req));
    const { collectTopIps, listVhostDefenseMarkers } = await import('@ysk/core');
    const top = collectTopIps(ctx.dataDir, 40);
    const vhosts = listVhostDefenseMarkers(ctx.dataDir);
    sendJson(res, 200, {
      topIps: top.items,
      topNotes: top.notes,
      vhosts: vhosts.items,
      vhostsWithLimit: vhosts.withLimit,
      vhostsTotal: vhosts.total,
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/cloudflare/under-attack') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      zones?: string[];
      enable?: boolean;
      dryRun?: boolean;
      level?: string;
    };
    const {
      enableCloudflareUnderAttack,
      disableCloudflareUnderAttack,
      loadDefenseAutomation,
    } = await import('@ysk/core');
    const auto = loadDefenseAutomation(ctx.db);
    const zones =
      data.zones?.length ? data.zones : auto.cloudflare.zones;
    const enable = data.enable !== false;
    const r = enable
      ? await enableCloudflareUnderAttack({
          zones,
          dryRun: data.dryRun === true || !ctx.host.executeEnabled(),
        })
      : await disableCloudflareUnderAttack({
          zones,
          level: (data.level as 'high') || 'high',
          dryRun: data.dryRun === true || !ctx.host.executeEnabled(),
        });
    ctx.audit.append({
      actor: user.username,
      action: 'defense.cloudflare.under_attack',
      detail: { enable, zones, ok: r.ok },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'PUT' && url.pathname === '/api/v1/defense/automation') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const {
      updateDefenseAutomation,
      getAutomationMechanismRows,
      syncWhitelistToFail2banIgnore,
    } = await import('@ysk/core');
    const automation = updateDefenseAutomation(ctx.db, data as never);
    if (automation.autoBan.syncFail2banIgnoreip) {
      try {
        syncWhitelistToFail2banIgnore(ctx.dataDir, automation.autoBan.whitelist);
      } catch {
        /* best-effort */
      }
    }
    ctx.audit.append({
      actor: user.username,
      action: 'defense.automation.update',
      detail: {
        enabled: automation.enabled,
        autoPreset: automation.autoPreset.enabled,
        autoBan: automation.autoBan.enabled,
      },
      ok: true,
    });
    sendJson(res, 200, { automation, mechanisms: getAutomationMechanismRows() });
    return true;
  }

  // —— GeoIP / IP 准入（國家·大陸·ASN）——
  if (method === 'GET' && url.pathname === '/api/v1/defense/geoip/status') {
    ctx.auth.authenticate(getBearer(req));
    const { getGeoipStatus } = await import('@ysk/core');
    const status = await getGeoipStatus(ctx.dataDir, ctx.db);
    const job =
      ctx.scheduler.get?.('defense-geoip-update') ??
      ctx.scheduler.list().find((j) => j.id === 'defense-geoip-update');
    sendJson(res, 200, {
      ...status,
      scheduler: job
        ? {
            intervalMs: job.intervalMs,
            lastRunAt: job.lastRunAt,
            nextRunAt: job.nextRunAt,
            running: job.running,
          }
        : null,
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/geoip/update') {
    const user = ctx.auth.authenticate(getBearer(req));
    const { updateGeoipDatabases, resetGeoipReaders, getGeoipStatus } = await import(
      '@ysk/core'
    );
    const r = await updateGeoipDatabases(ctx.dataDir);
    resetGeoipReaders();
    const status = await getGeoipStatus(ctx.dataDir, ctx.db);
    ctx.audit.append({
      actor: user.username,
      action: 'defense.geoip.update',
      detail: { ok: r.ok, notes: r.notes.slice(0, 8) },
      ok: r.ok,
    });
    sendOpsResult(res, { ...r, status });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/defense/geoip/policy') {
    ctx.auth.authenticate(getBearer(req));
    const { loadIpAccessPolicy } = await import('@ysk/core');
    sendJson(res, 200, { policy: loadIpAccessPolicy(ctx.db, ctx.dataDir) });
    return true;
  }
  if (method === 'PUT' && url.pathname === '/api/v1/defense/geoip/policy') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const { updateIpAccessPolicy, applyIpAccessNginx } = await import('@ysk/core');
    const policy = updateIpAccessPolicy(ctx.db, ctx.dataDir, data as never);
    let applyNotes: string[] = [];
    if (policy.enforce.nginx) {
      const a = applyIpAccessNginx(ctx.dataDir, ctx.db);
      applyNotes = a.notes;
    }
    ctx.audit.append({
      actor: user.username,
      action: 'defense.geoip.policy',
      detail: {
        enabled: policy.enabled,
        mode: policy.mode,
        countries: policy.countries.length,
        asns: policy.asns.length,
      },
      ok: true,
    });
    sendJson(res, 200, { policy, applyNotes });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/geoip/lookup') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ip?: string };
    const { lookupIpWithPolicy, loadAutoBanPolicy, loadDefenseAutomation } =
      await import('@ysk/core');
    const auto = loadDefenseAutomation(ctx.db);
    const legacy = loadAutoBanPolicy(ctx.db);
    const whitelist = [
      ...new Set([...(auto.autoBan.whitelist ?? []), ...(legacy.whitelist ?? [])]),
    ];
    const r = await lookupIpWithPolicy(
      ctx.dataDir,
      ctx.db,
      data.ip ?? '',
      whitelist,
    );
    sendJson(res, 200, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/geoip/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const { applyIpAccessNginx, getGeoipStatus } = await import('@ysk/core');
    const a = applyIpAccessNginx(ctx.dataDir, ctx.db);
    const status = await getGeoipStatus(ctx.dataDir, ctx.db);
    ctx.audit.append({
      actor: user.username,
      action: 'defense.geoip.apply',
      detail: { ok: a.ok, path: a.path },
      ok: a.ok,
    });
    sendOpsResult(res, { ...a, status });
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
      sendJson(res, 404, { ok: false, message: tl('notes.auto.n0969') });
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
    sendOpsResult(res, result);
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
    sendOpsResult(res, result);
    return true;
  }

  // —— Stack plans / install / uninstall (bundle wizard) ——
  if (method === 'GET' && url.pathname === '/api/v1/system/stack') {
    ctx.auth.authenticate(getBearer(req));
    const st = await getStackStatus({ host: ctx.host, dataDir: ctx.dataDir });
    sendJson(res, 200, {
      ok: true,
      ...st,
      executeEnabled: ctx.host.executeEnabled(),
      isRoot: ctx.host.isRoot(),
    });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/stack/plans') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, {
      ok: true,
      plans: listStackPlans(),
      bundles: listStackBundles(),
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/stack/expand') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      plan?: string;
      bundles?: string[];
      sqlServer?: 'mariadb' | 'mysql';
      clamav?: boolean;
    };
    const r = expandComponents(
      { plan: data.plan, bundles: data.bundles },
      { sqlServer: data.sqlServer, clamav: data.clamav },
    );
    sendJson(res, r.ok ? 200 : 400, r);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/stack/scan') {
    const user = ctx.auth.authenticate(getBearer(req));
    const scan = await scanStack({ host: ctx.host, dataDir: ctx.dataDir });
    ctx.audit.append({
      actor: user.username,
      action: 'system.stack.scan',
      detail: { components: Object.keys(scan.manifest.components).length },
      ok: true,
    });
    sendJson(res, 200, { ok: true, ...scan });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/stack/install') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      plan?: string;
      bundles?: string[];
      sqlServer?: 'mariadb' | 'mysql';
      clamav?: boolean;
      dryRun?: boolean;
    };
    const result = await installStack({
      host: ctx.host,
      dataDir: ctx.dataDir,
      plan: data.plan,
      bundles: data.bundles,
      options: { sqlServer: data.sqlServer, clamav: data.clamav },
      dryRun: data.dryRun === true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.stack.install',
      detail: {
        plan: data.plan,
        bundles: data.bundles,
        dryRun: data.dryRun,
        ok: result.ok,
        blocked: result.blocked,
      },
      ok: result.ok,
    });
    sendOpsResult(res, result as unknown as Record<string, unknown>);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/stack/uninstall') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      all?: boolean;
      bundles?: string[];
      components?: string[];
      dataPolicy?: 'keep' | 'purge';
      removeProduct?: boolean;
      dryRun?: boolean;
    };
    const result = await uninstallStack({
      host: ctx.host,
      dataDir: ctx.dataDir,
      all: data.all,
      bundles: data.bundles,
      components: data.components,
      dataPolicy: data.dataPolicy ?? 'keep',
      removeProduct: data.removeProduct,
      dryRun: data.dryRun === true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.stack.uninstall',
      detail: {
        all: data.all,
        bundles: data.bundles,
        components: data.components,
        dataPolicy: data.dataPolicy,
        dryRun: data.dryRun,
        ok: result.ok,
        blocked: result.blocked,
      },
      ok: result.ok,
    });
    sendOpsResult(res, result as unknown as Record<string, unknown>);
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

  if (method === 'GET' && url.pathname === '/api/v1/system/firewall/status') {
    ctx.auth.authenticate(getBearer(req));
    const { probeFirewallDeep } = await import('@ysk/core');
    const st = (await probeFirewallDeep(ctx.host)) as Record<string, unknown>;
    const q = (url.searchParams.get('q') ?? '').trim();
    if (q && Array.isArray(st.numberedRules)) {
      const { listWithQuery } = await import('../http/list-response.js');
      const rules = st.numberedRules as Array<Record<string, unknown>>;
      const { items, meta } = listWithQuery(url, rules, {
        text: (r) => [
          String(r.num ?? ''),
          String(r.action ?? ''),
          String(r.to ?? ''),
          String(r.from ?? ''),
          String(r.raw ?? ''),
        ],
      });
      sendJson(res, 200, { ...st, numberedRules: items, rulesMeta: meta });
      return true;
    }
    sendJson(res, 200, st);
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
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/enable') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { enabled?: boolean };
    const { firewallSetEnabled } = await import('@ysk/core');
    const r = await firewallSetEnabled(ctx.host, data.enabled !== false);
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.enable',
      detail: { enabled: data.enabled !== false, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/deny') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ip?: string };
    const { firewallDenyIp } = await import('@ysk/core');
    const r = await firewallDenyIp(ctx.host, data.ip ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.deny',
      detail: { ip: data.ip, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/delete-deny') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ip?: string };
    const { firewallDeleteDenyIp } = await import('@ysk/core');
    const r = await firewallDeleteDenyIp(ctx.host, data.ip ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.delete_deny',
      detail: { ip: data.ip, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/delete-rule') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { num?: number };
    const { firewallDeleteRuleNumber } = await import('@ysk/core');
    const r = await firewallDeleteRuleNumber(ctx.host, Number(data.num));
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.delete_rule',
      detail: { num: data.num, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/firewall/service-ports') {
    ctx.auth.authenticate(getBearer(req));
    const { listFirewallPortChips, YSK_SERVICE_PORTS } = await import('@ysk/shared');
    sendJson(res, 200, {
      ok: true,
      chips: listFirewallPortChips(),
      catalog: YSK_SERVICE_PORTS,
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/allow-port') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      port?: number | string;
      proto?: 'tcp' | 'udp';
    };
    const { firewallAllowPort } = await import('@ysk/core');
    // number | "80" | "30000:30100" | "53/udp" (proto from body wins if set)
    const portArg =
      typeof data.port === 'number'
        ? data.port
        : String(data.port ?? '')
            .trim()
            .replace(/\/(tcp|udp)$/i, '');
    const r = await firewallAllowPort(ctx.host, portArg, data.proto ?? 'tcp');
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.allow_port',
      detail: { port: portArg, proto: data.proto ?? 'tcp' },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/fail2ban/status') {
    ctx.auth.authenticate(getBearer(req));
    const { getFail2banDeepStatus } = await import('@ysk/core');
    sendJson(
      res,
      200,
      await getFail2banDeepStatus({ host: ctx.host, dataDir: ctx.dataDir }),
    );
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/fail2ban/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      apply?: boolean;
      jails?: string[];
      bantime?: string;
      findtime?: string;
      maxretry?: number;
    };
    const result = await applyFail2ban({
      dataDir: ctx.dataDir,
      host: ctx.host,
      apply: data.apply,
      jails: data.jails,
      bantime: data.bantime,
      findtime: data.findtime,
      maxretry: data.maxretry,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.fail2ban.apply',
      detail: result,
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/fail2ban/service') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      action?: 'start' | 'stop' | 'restart' | 'reload' | 'enable';
    };
    const { fail2banService } = await import('@ysk/core');
    const r = await fail2banService(ctx.host, data.action ?? 'reload');
    ctx.audit.append({
      actor: user.username,
      action: 'system.fail2ban.service',
      detail: { action: data.action, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/fail2ban/ban') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { jail?: string; ip?: string };
    const { fail2banBanIp } = await import('@ysk/core');
    const r = await fail2banBanIp(ctx.host, data.jail ?? 'sshd', data.ip ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'system.fail2ban.ban',
      detail: data,
      ok: r.ok,
    });
    sendOpsResult(res, r);
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
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/fail2ban/ignoreip') {
    ctx.auth.authenticate(getBearer(req));
    const { readIgnoreIpList } = await import('@ysk/core');
    sendJson(res, 200, { items: readIgnoreIpList(ctx.dataDir) });
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
    sendOpsResult(res, r);
    return true;
  }

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
    if (data.hostname?.trim()) {
      const r = await ctx.host.runCommand(['hostnamectl', 'set-hostname', data.hostname.trim()], {
        timeoutMs: 10_000,
      });
      notes.push(
        r.exitCode === 0
          ? `hostname → ${data.hostname.trim()}`
          : tl('notes.auto.t0795', { v0: (r.stderr || r.stdout) }),
      );
    }
    if (data.prettyHostname !== undefined) {
      const pretty = data.prettyHostname.trim();
      const r = await ctx.host.runCommand(
        ['hostnamectl', 'set-hostname', '--pretty', pretty || ' '],
        { timeoutMs: 10_000 },
      );
      notes.push(
        r.exitCode === 0
          ? `pretty hostname → ${pretty || '(cleared)'}`
          : tl('notes.auto.t0796', { v0: (r.stderr || r.stdout) }),
      );
    }
    if (data.timezone?.trim()) {
      const tz = data.timezone.trim();
      const { isValidTimezoneId, listHostTimezones } = await import('@ysk/core');
      if (!isValidTimezoneId(tz)) {
        notes.push(tl('notes.auto.t0797', { v0: 'invalid timezone id' }));
      } else {
        // Prefer host list; still allow well-formed IANA if list is fallback/short
        const listed = await listHostTimezones(ctx.host);
        if (listed.source === 'timedatectl' && !listed.timezones.includes(tz)) {
          notes.push(tl('notes.auto.t0797', { v0: `not in host timezone list: ${tz}` }));
        } else {
          const r = await ctx.host.runCommand(['timedatectl', 'set-timezone', tz], {
            timeoutMs: 10_000,
          });
          notes.push(
            r.exitCode === 0
              ? `timezone → ${tz}`
              : tl('notes.auto.t0797', { v0: r.stderr || r.stdout }),
          );
        }
      }
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

  return false;
}
