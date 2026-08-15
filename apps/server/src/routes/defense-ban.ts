/**
 * Defense ban/unban/preset/stack/timeline/suspects.
 * Extracted from defense-ops.ts (Wave P2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleDefenseBanRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— Defense Center (DDoS / attack protection) ——
  if (method === 'GET' && url.pathname === '/api/v1/defense/status') {
    ctx.auth.authenticate(getBearer(req));
    const { getDefenseStatus } = await import('ysk-server-core');
    const status = await getDefenseStatus({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      requestCountLastMinute: ctx.requestHitsLastMinute(),
    });
    sendJson(res, 200, status);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/defense/probe') {
    const user = ctx.auth.authenticate(getBearer(req));
    const { getDefenseStatus } = await import('ysk-server-core');
    await ctx.runAutoProtection();
    const status = await getDefenseStatus({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      requestCountLastMinute: ctx.requestHitsLastMinute(),
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
    const { applyDefensePreset } = await import('ysk-server-core');
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
    const { listDefenseBans } = await import('ysk-server-core');
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
    const { applyDefenseStack } = await import('ysk-server-core');
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
    const { defenseBanIp } = await import('ysk-server-core');
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
    const { defenseUnbanIp } = await import('ysk-server-core');
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
    const { listDefenseTimeline } = await import('ysk-server-core');
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
    const { listSuspectIps } = await import('ysk-server-core');
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
    const { defenseBanBatch } = await import('ysk-server-core');
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

  return false;
}
