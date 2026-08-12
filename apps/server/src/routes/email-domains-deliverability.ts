/**
 * Email domain deliverability / DNS / policy / warmup (Wave S2).
 * Extracted from email-domains-ops.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  planEmailWarmup,
  runLiveEmailChecks,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

function redactEmail<T extends { dkim_private_key?: string }>(e: T) {
  return { ...e, dkim_private_key: '***redacted***' };
}

export async function handleEmailDomainsDeliverabilityRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— Deliverability ops pack (C3) ——
  if (
    method === 'GET' &&
    url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/deliverability$/)
  ) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const row = ctx.email.get(id);
    const { buildDeliverabilityReport } = await import('ysk-server-core');
    const report = await buildDeliverabilityReport({
      domain: row.domain,
      serverIp: row.server_ip,
      serverIpv6: row.server_ipv6,
      mailHostname: row.mail_hostname,
      dkimPublicKey: row.dkim_public_key ?? '',
      dataDir: ctx.dataDir,
      ptrOkStored: row.ptr_ok ?? undefined,
      port25Stored: row.port25_open ?? undefined,
      dnsApplied: row.dns_applied ?? undefined,
      dmarcPresent: row.dmarc_present ?? undefined,
    });
    sendJson(res, 200, report);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/email/deliverability/overview') {
    ctx.auth.authenticate(getBearer(req));
    const { buildDeliverabilityReport } = await import('ysk-server-core');
    const domains = ctx.email.list();
    const items = [];
    for (const d of domains.slice(0, 20)) {
      try {
        const report = await buildDeliverabilityReport({
          domain: d.domain,
          serverIp: d.server_ip,
          serverIpv6: d.server_ipv6,
          mailHostname: d.mail_hostname,
          dkimPublicKey: d.dkim_public_key ?? '',
          dataDir: ctx.dataDir,
        });
        items.push({
          domainId: d.id,
          domain: d.domain,
          score: report.score,
          panelReady: report.panelReady,
          deliveryGuaranteed: false as const,
          blocked: report.items.filter((i) => i.ok === false).map((i) => i.id),
        });
      } catch (e) {
        items.push({
          domainId: d.id,
          domain: d.domain,
          score: 0,
          panelReady: false,
          deliveryGuaranteed: false as const,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    sendJson(res, 200, {
      at: new Date().toISOString(),
      items,
      honesty: [
        'Overview is advisory only — never guarantees inbox placement.',
        'PTR and Port 25 remain VPS-provider responsibilities.',
      ],
    });
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/dns$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    sendJson(res, 200, ctx.email.getDnsBundle(id));
    return true;
  }
  if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/checks$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      dnsApplied?: boolean;
      dmarcPresent?: boolean;
      ptrOk?: boolean;
      port25Open?: boolean | null;
    };
    sendJson(res, 200, ctx.email.updateChecks(id, data, user.username));
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/test-send$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { from?: string; to?: string; subject?: string };
    const result = await ctx.email.testSend(
      id,
      { from: data.from ?? '', to: data.to ?? '', subject: data.subject },
      user.username,
    );
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/flags$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      catchallAddress?: string | null;
      autoreplyEnabled?: boolean;
      autoreplySubject?: string;
      autoreplyBody?: string;
      rateLimitPerHour?: number | null;
      antispam?: boolean;
      suspended?: boolean;
      applySystem?: boolean;
    };
    const result = await ctx.email.updateDomainMailFlags(id, data, user.username);
    sendOpsResult(res, {
      ok: result.ok,
      apply_status: result.apply_status,
      notes: result.notes,
      written: result.written,
      blocked: result.blocked,
      blockMessage: result.blockMessage,
      commandResults: result.commandResults,
      domain: redactEmail(result.domain as unknown as Record<string, unknown>) });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/live-check$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const d = ctx.email.get(id);
    const live = await runLiveEmailChecks({
      domain: d.domain,
      serverIp: d.server_ip,
      mailHostname: d.mail_hostname,
      dkimPublicKey: d.dkim_public_key,
      dkimSelector: d.dkim_selector });
    // Persist real probe results into domain health (not marketing scores)
    try {
      ctx.email.updateChecks(
        id,
        {
          dnsApplied: live.mx.ok && live.spf.ok && live.dkim.ok,
          dmarcPresent: live.dmarc.ok,
          ptrOk: live.ptr.ok,
          port25Open: live.port25.ok },
        user.username,
      );
    } catch {
      /* non-fatal */
    }
    sendJson(res, 200, {
      ...live,
      ok: live.health.score >= 60 && live.dnsbl.ok });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/policy$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      rateLimitPerHour?: number | null;
      antispam?: boolean;
      applySystem?: boolean;
    };
    const domain = ctx.email.get(id);
    await ctx.email.updateDomainMailFlags(
      id,
      {
        rateLimitPerHour: data.rateLimitPerHour,
        antispam: data.antispam },
      user.username,
    );
    const { applyMailDomainPolicy } = await import('ysk-server-core');
    const r = await applyMailDomainPolicy({
      dataDir: ctx.dataDir,
      host: ctx.host,
      domain: domain.domain,
      rateLimitPerHour: data.rateLimitPerHour,
      antispam: data.antispam,
      applySystem: data.applySystem });
    ctx.audit.append({
      actor: user.username,
      action: 'email.domain.policy',
      resource: id,
      detail: r,
      ok: r.ok });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/warmup$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const d = ctx.email.get(id);
    const plan = planEmailWarmup({
      domain: d.domain,
      serverIp: d.server_ip,
      isNewIp: true });
    sendJson(res, 200, plan);
    return true;
  }

  return false;
}
