import { tl } from '@ysk/shared';
/**
 * Defense Center + protection + geoip routes.
 * Extracted from system-controller (Wave C1). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { SystemRole } from '@ysk/shared';
import {
  evaluateProtection,
  runProtectionProbes,
  getPlaybook,
} from '@ysk/core';
import { applyProtection, type AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleDefenseRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // Legacy simple protection setter (pre-Defense Center)
  if (method === 'POST' && url.pathname === '/api/v1/protection') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      networkReachable?: boolean;
      ddosSuspected?: boolean;
      forceOffline?: boolean;
      highRequestRate?: boolean;
    };
    const state = evaluateProtection({
      networkReachable: data.networkReachable ?? true,
      ddosSuspected: data.ddosSuspected,
      forceOffline: data.forceOffline,
      highRequestRate: data.highRequestRate,
    });
    applyProtection(ctx, state);
    ctx.audit.append({
      actor: user.username,
      action: 'protection.set',
      detail: state,
      ok: true,
    });
    sendJson(res, 200, ctx.protection);
    return true;
  }

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


  return false;
}
