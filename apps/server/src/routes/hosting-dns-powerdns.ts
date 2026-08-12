/**
 * Hosting PowerDNS install / heal / load / status (Wave Z1).
 * Extracted from hosting-infra-dns.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  applyPowerDnsZone,
  powerDnsStatus,
  installPowerDnsPackages,
} from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleHostingDnsPowerdnsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/hosting/dns/powerdns/status') {
    ctx.auth.authenticate(getBearer(req));
    const status = await powerDnsStatus({ dataDir: ctx.dataDir, host: ctx.host });
    sendJson(res, 200, status);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/powerdns/install') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      install?: boolean;
      localAddress?: string;
    };
    const result = await installPowerDnsPackages({
      dataDir: ctx.dataDir,
      host: ctx.host,
      install: data.install,
      localAddress: data.localAddress,
    });
    if (result.ok && data.install) {
      try {
        const { syncServiceExposure, dnsPortBindings } = await import('@yanshekki/core');
        const exp = await syncServiceExposure({
          host: ctx.host,
          dataDir: ctx.dataDir,
          serviceId: 'pdns',
          ports: dnsPortBindings(),
          reason: 'start',
          requireDecision: false,
        });
        if (exp.notes?.length) {
          (result as { notes?: string[] }).notes = [
            ...((result as { notes?: string[] }).notes ?? []),
            ...exp.notes.slice(0, 3),
          ];
        }
      } catch {
        /* non-fatal */
      }
    }
    ctx.audit.append({
      actor: user.username,
      action: 'dns.powerdns.install',
      detail: { ok: result.ok, install: Boolean(data.install) },
      ok: result.ok,
    });
    sendJson(res, result.ok || !data.install ? 200 : 422, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/powerdns/heal') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      localAddress?: string;
      resyncZones?: boolean;
    };
    const { healPowerDnsListener } = await import('@yanshekki/core');
    const result = await healPowerDnsListener({
      host: ctx.host,
      localAddress: data.localAddress,
      dataDir: ctx.dataDir,
      resyncZones: data.resyncZones,
    });
    if (result.ok) {
      try {
        const { syncServiceExposure, dnsPortBindings } = await import('@yanshekki/core');
        const exp = await syncServiceExposure({
          host: ctx.host,
          dataDir: ctx.dataDir,
          serviceId: 'pdns',
          ports: dnsPortBindings(),
          reason: 'start',
          requireDecision: false,
        });
        if (exp.notes?.length) {
          (result as { notes?: string[] }).notes = [
            ...((result as { notes?: string[] }).notes ?? []),
            ...exp.notes.slice(0, 3),
          ];
        }
      } catch {
        /* non-fatal */
      }
    }
    ctx.audit.append({
      actor: user.username,
      action: 'dns.powerdns.heal',
      detail: {
        ok: result.ok,
        localAddress: result.localAddress,
        unitActive: result.unitActive,
        listenUdp53: result.listenUdp53,
      },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/powerdns/load') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      zone?: string;
      serverIp?: string;
      mailHost?: string;
      load?: boolean;
    };
    const result = await applyPowerDnsZone({
      dataDir: ctx.dataDir,
      host: ctx.host,
      zone: data.zone ?? 'example.com',
      serverIp: data.serverIp ?? '203.0.113.10',
      mailHost: data.mailHost,
      load: data.load,
    });
    ctx.db.snapshot.dns_zones = [
      {
        id: randomUUID(),
        zone: result.zone,
        provider: 'powerdns',
        zonePath: result.zonePath,
        mode: result.mode,
        ok: result.ok,
        updated_at: new Date().toISOString(),
        actor: user.username,
      },
      ...ctx.db.snapshot.dns_zones.filter(
        (z) => !(String(z.zone) === result.zone && z.provider === 'powerdns'),
      ),
    ].slice(0, 50);
    ctx.db.persist();
    ctx.audit.append({
      actor: user.username,
      action: 'dns.powerdns.load',
      resource: result.zone,
      detail: { mode: result.mode, ok: result.ok, zonePath: result.zonePath },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
