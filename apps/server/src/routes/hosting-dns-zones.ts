/**
 * Hosting DNS zone plan/files + Cloudflare (Wave Z1).
 * Extracted from hosting-infra-dns.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  planDnsZone,
  listManagedDnsZones,
  applyPowerDnsZone,
  applyCloudflareDns,
  persistDnsZoneApply,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleHostingDnsZonesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/plan') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      zone?: string;
      serverIp?: string;
      serverIpv6?: string;
    };
    sendJson(
      res,
      200,
      planDnsZone({
        zone: data.zone ?? 'example.com',
        serverIp: data.serverIp ?? '1.2.3.4',
        serverIpv6: data.serverIpv6,
      }),
    );
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/zone-file') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      zone?: string;
      serverIp?: string;
      serverIpv6?: string;
      mailHost?: string;
      validate?: boolean;
      /** default true: register into PowerDNS after write (needs EXECUTE+root) */
      load?: boolean;
    };
    const wantLoad = data.load !== false;
    // Align with panel apply: write zone file, then optional PowerDNS BIND load
    const result = await applyPowerDnsZone({
      dataDir: ctx.dataDir,
      host: ctx.host,
      zone: data.zone ?? 'example.com',
      serverIp: data.serverIp ?? '203.0.113.10',
      serverIpv6: data.serverIpv6,
      mailHost: data.mailHost,
      load: wantLoad,
      rewriteZone: true,
    });
    const applyStatus =
      result.mode === 'loaded'
        ? 'applied'
        : result.mode === 'plan'
          ? 'written'
          : result.ok
            ? 'written'
            : 'failed';
    ctx.db.snapshot.dns_zones = [
      {
        id: randomUUID(),
        zone: result.zone,
        provider: wantLoad ? 'powerdns' : 'bind-file',
        zonePath: result.zonePath,
        mode: result.mode,
        apply_status: applyStatus,
        loadMethod: result.loadMethod,
        ok: result.ok,
        updated_at: new Date().toISOString(),
        actor: user.username,
      },
      ...ctx.db.snapshot.dns_zones.filter(
        (z) =>
          !(
            String(z.zone) === result.zone &&
            (z.provider === 'bind-file' || z.provider === 'powerdns')
          ),
      ),
    ].slice(0, 50);
    ctx.db.persist();
    ctx.audit.append({
      actor: user.username,
      action: wantLoad ? 'dns.zone_file.write_load' : 'dns.zone_file.write',
      resource: result.zone,
      detail: {
        zonePath: result.zonePath,
        mode: result.mode,
        loadMethod: result.loadMethod,
        ok: result.ok,
      },
      ok: result.ok || result.mode === 'plan',
    });
    sendOpsResult(res, {
      ...result,
      applyStatus,
      // plan-only write still HTTP-ok for operators previewing
      ok: result.ok || result.mode === 'plan',
    });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/hosting/dns/zone-files') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, { items: listManagedDnsZones(ctx.dataDir) });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/cloudflare/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      zone?: string;
      serverIp?: string;
      serverIpv6?: string;
      mailHost?: string;
      token?: string;
      dryRun?: boolean;
    };
    const result = await applyCloudflareDns({
      zone: data.zone ?? 'example.com',
      serverIp: data.serverIp ?? '203.0.113.10',
      serverIpv6: data.serverIpv6,
      mailHost: data.mailHost,
      token: data.token,
      dryRun: data.dryRun,
    });
    persistDnsZoneApply(ctx.db, result, user.username);
    ctx.audit.append({
      actor: user.username,
      action: 'dns.cloudflare.apply',
      resource: result.zoneName,
      detail: {
        ok: result.ok,
        dryRun: result.dryRun,
        created: result.created.length,
        errors: result.errors,
      },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/hosting/dns/zones') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, { items: ctx.db.snapshot.dns_zones });
    return true;
  }

  return false;
}
