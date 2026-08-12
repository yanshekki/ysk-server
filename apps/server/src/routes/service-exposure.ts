/**
 * Service network exposure API — desired mode + UFW sync (ysk-svc comments).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

const BASE = '/api/v1/system/network/service-exposure';

export async function handleServiceExposureRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // GET all
  if (method === 'GET' && url.pathname === BASE) {
    ctx.auth.authenticate(getBearer(req));
    const { listDesired, getServiceExposureStatus } = await import('@ysk-server/core');
    const { YSK_SERVICE_PORTS, defaultPortsForService } = await import('@ysk-server/shared');
    const desired = listDesired(ctx.dataDir);
    const known = [...new Set(YSK_SERVICE_PORTS.map((p) => p.service))];
    const items = [];
    for (const sid of known) {
      const st = await getServiceExposureStatus(ctx.host, ctx.dataDir, sid);
      items.push({
        serviceId: sid,
        ...st,
        catalogPorts: defaultPortsForService(sid),
      });
    }
    for (const d of desired) {
      if (known.includes(d.serviceId)) continue;
      const st = await getServiceExposureStatus(ctx.host, ctx.dataDir, d.serviceId);
      items.push({ serviceId: d.serviceId, ...st });
    }
    sendJson(res, 200, { ok: true, items });
    return true;
  }

  // GET one
  const oneMatch = url.pathname.match(
    /^\/api\/v1\/system\/network\/service-exposure\/([^/]+)$/,
  );
  if (method === 'GET' && oneMatch) {
    ctx.auth.authenticate(getBearer(req));
    const serviceId = decodeURIComponent(oneMatch[1]!);
    const { getServiceExposureStatus } = await import('@ysk-server/core');
    const st = await getServiceExposureStatus(ctx.host, ctx.dataDir, serviceId);
    sendJson(res, 200, { ok: true, serviceId, ...st });
    return true;
  }

  // PUT one — update desired + sync
  if (method === 'PUT' && oneMatch) {
    const user = ctx.auth.authenticate(getBearer(req));
    const serviceId = decodeURIComponent(oneMatch[1]!);
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      mode?: 'private' | 'public' | 'restricted';
      ports?: Array<{ role: string; port: string; proto?: string }>;
      allowFrom?: string[];
      /** L2 ISO country codes */
      allowCountries?: string[];
      sync?: boolean;
    };
    const { putServiceExposure } = await import('@ysk-server/core');
    const result = await putServiceExposure({
      host: ctx.host,
      dataDir: ctx.dataDir,
      serviceId,
      mode: data.mode,
      ports: data.ports as never,
      allowFrom: data.allowFrom,
      allowCountries: data.allowCountries,
      sync: data.sync !== false,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.service_exposure.put',
      detail: { serviceId, mode: data.mode },
      ok: result.ok,
    });
    if ('applied' in result) {
      sendOpsResult(res, result);
    } else {
      sendJson(res, 200, result);
    }
    return true;
  }

  // POST sync
  if (method === 'POST' && url.pathname === `${BASE}/sync`) {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      serviceId?: string;
      ports?: Array<{ role: string; port: string; proto?: string }>;
      reason?: 'start' | 'apply' | 'port-change' | 'manual' | 'stop';
      exposureDecision?: 'keep-private' | 'public' | 'restricted';
      allowFrom?: string[];
      allowCountries?: string[];
      requireDecision?: boolean;
    };
    const serviceId = String(data.serviceId ?? '').trim();
    if (!serviceId) {
      sendJson(res, 400, { ok: false, notes: ['serviceId required'] });
      return true;
    }
    const { syncServiceExposure } = await import('@ysk-server/core');
    const result = await syncServiceExposure({
      host: ctx.host,
      dataDir: ctx.dataDir,
      serviceId,
      ports: data.ports as never,
      reason: data.reason ?? 'manual',
      exposureDecision: data.exposureDecision,
      allowFrom: data.allowFrom,
      allowCountries: data.allowCountries,
      requireDecision: data.requireDecision,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.service_exposure.sync',
      detail: {
        serviceId,
        reason: data.reason,
        needsExposureDecision: result.needsExposureDecision,
      },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
