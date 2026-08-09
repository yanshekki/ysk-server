/**
 * Defense GeoIP / IP access policy (Wave M2).
 * Extracted from defense.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleDefenseGeoipRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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


  return false;
}
