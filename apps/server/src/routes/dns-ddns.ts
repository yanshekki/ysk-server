/**
 * Host WAN DDNS — status, records, settings, probe, manual tick.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';
import {
  deleteDdnsRecord,
  getDdnsStatus,
  mergeDdnsSecrets,
  patchDdnsSettings,
  runDdnsTick,
  upsertDdnsRecord,
} from 'ysk-server-core';
import type { DdnsProviderId, DdnsRecordType } from 'ysk-server-shared';
import { tl } from 'ysk-server-shared';

export async function handleDnsDdnsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/dns/ddns')) return false;

  if (method === 'GET' && url.pathname === '/api/v1/dns/ddns') {
    ctx.auth.authenticate(getBearer(req));
    const probe =
      url.searchParams.get('probe') === '1' || url.searchParams.get('probe') === 'true';
    const st = await getDdnsStatus({
      dataDir: ctx.dataDir,
      executeEnabled: ctx.host.executeEnabled(),
      probe,
      nextRunAt: ctx.scheduler.get('ddns-wan')?.nextRunAt ?? null,
    });
    sendJson(res, 200, { ok: true, ...st });
    return true;
  }

  if (method === 'PATCH' && url.pathname === '/api/v1/dns/ddns/settings') {
    ctx.auth.authenticate(getBearer(req));
    const data = JSON.parse((await readBody(req)) || '{}') as {
      intervalSeconds?: number;
      updateIdentity?: boolean;
      primaryFqdn?: string;
      enabled?: boolean;
      cloudflareToken?: string;
      rfc2136?: { server?: string; keyFile?: string };
    };
    patchDdnsSettings(ctx.dataDir, {
      intervalSeconds: data.intervalSeconds,
      updateIdentity: data.updateIdentity,
      primaryFqdn: data.primaryFqdn,
      enabled: data.enabled,
    });
    if (data.cloudflareToken || data.rfc2136) {
      mergeDdnsSecrets(ctx.dataDir, {
        cloudflareToken: data.cloudflareToken,
        rfc2136: data.rfc2136
          ? { server: data.rfc2136.server ?? '127.0.0.1', keyFile: data.rfc2136.keyFile }
          : undefined,
      });
    }
    sendJson(res, 200, {
      ok: true,
      ...(await getDdnsStatus({
        dataDir: ctx.dataDir,
        executeEnabled: ctx.host.executeEnabled(),
        nextRunAt: ctx.scheduler.get('ddns-wan')?.nextRunAt ?? null,
      })),
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/dns/ddns/records') {
    ctx.auth.authenticate(getBearer(req));
    const data = JSON.parse((await readBody(req)) || '{}') as {
      id?: string;
      fqdn?: string;
      type?: DdnsRecordType;
      provider?: DdnsProviderId;
      zone?: string;
      ttl?: number;
      proxied?: boolean;
      enabled?: boolean;
    };
    const r = upsertDdnsRecord(ctx.dataDir, {
      id: data.id,
      fqdn: String(data.fqdn ?? ''),
      type: (data.type ?? 'A') as DdnsRecordType,
      provider: (data.provider ?? 'cloudflare') as DdnsProviderId,
      zone: data.zone,
      ttl: data.ttl,
      proxied: data.proxied,
      enabled: data.enabled,
    });
    sendOpsResult(res, r);
    return true;
  }

  const recDel = url.pathname.match(/^\/api\/v1\/dns\/ddns\/records\/([^/]+)$/);
  if (method === 'DELETE' && recDel) {
    ctx.auth.authenticate(getBearer(req));
    const data = JSON.parse((await readBody(req)) || '{}') as { confirm?: string };
    const r = deleteDdnsRecord(ctx.dataDir, decodeURIComponent(recDel[1] ?? ''), String(data.confirm ?? ''));
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/dns/ddns/update') {
    const user = ctx.auth.authenticate(getBearer(req));
    const data = JSON.parse((await readBody(req)) || '{}') as { execute?: boolean; force?: boolean };
    const execute = data.execute === true && ctx.host.executeEnabled();
    const st = await runDdnsTick({
      dataDir: ctx.dataDir,
      host: ctx.host,
      db: ctx.db,
      execute,
      force: data.force === true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'dns.ddns.update',
      detail: {
        execute,
        force: data.force === true,
        requiresExecute: st.requiresExecute,
        detected: st.detected.ipv4,
      },
      ok: !st.detected.error,
    });
    const publishFail = st.records.some(
      (r) => r.enabled && r.lastError && r.lastError !== 'requiresExecute',
    );
    sendOpsResult(res, {
      ...st,
      ok: !st.detected.error && !publishFail,
      executed: execute,
    });
    return true;
  }

  sendJson(res, 404, { ok: false, message: tl('errors.http.notFound') });
  return true;
}
