/**
 * Defense auto-ban, automation, intel, cloudflare under-attack.
 * Extracted from defense-ops.ts (Wave P2). Behaviour preserved.
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

export async function handleDefenseAutomationRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/defense/auto-ban') {
    ctx.auth.authenticate(getBearer(req));
    const { loadAutoBanPolicy, countAutoBansLastHour } = await import('ysk-server-core');
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
    const { updateAutoBanPolicy, countAutoBansLastHour } = await import('ysk-server-core');
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
    } = await import('ysk-server-core');
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
    const { runDefenseAutomationTick } = await import('ysk-server-core');
    const r = await runDefenseAutomationTick({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      requestCountLastMinute: ctx.requestHitsLastMinute(),
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
    } = await import('ysk-server-core');
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
    const { collectTopIps, listVhostDefenseMarkers } = await import('ysk-server-core');
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
    } = await import('ysk-server-core');
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
    } = await import('ysk-server-core');
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

  return false;
}
