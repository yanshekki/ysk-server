/**
 * DNS tools — checklist / health / lookup / validate / DNSSEC (Wave X2).
 * Extracted from dns.ts. Behaviour preserved.
 */
import { tl } from '@ysk/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleDnsToolsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/dns/external-checklist') {
    ctx.auth.authenticate(getBearer(req));
    const domain = (url.searchParams.get('domain') ?? '').trim().toLowerCase();
    const scope = (url.searchParams.get('scope') ?? 'full') as 'mail' | 'web' | 'full';
    if (!domain) {
      sendJson(res, 400, { ok: false, message: tl('notes.auto.n0259') });
      return true;
    }
    const { buildExternalTodos } = await import('@ysk/core');
    const mailHostname =
      ctx.email.list().find((d) => d.domain === domain)?.mail_hostname || `mail.${domain}`;
    const items = buildExternalTodos({
      domain,
      mailHostname,
      scope: scope === 'web' || scope === 'mail' ? scope : 'full',
    });
    sendJson(res, 200, {
      domain,
      scope,
      items,
      notes: [tl('notes.auto.n1039')],
    });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/dns/health') {
    ctx.auth.authenticate(getBearer(req));
    const digName = (url.searchParams.get('name') ?? '').trim() || undefined;
    const { probeDnsServiceHealth } = await import('@ysk/core');
    const r = await probeDnsServiceHealth({
      dataDir: ctx.dataDir,
      host: ctx.host,
      digName,
    });
    sendJson(res, 200, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/dns/probe-local') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      name?: string;
      type?: string;
    };
    const { digLocalAuthoritative } = await import('@ysk/core');
    const r = await digLocalAuthoritative({
      host: ctx.host,
      name: data.name ?? '',
      type: data.type ?? 'SOA',
    });
    sendOpsResult(res, {
      ok: r.ok,
      notes: r.notes,
      answers: r.answers,
      method: r.method,
      name: data.name,
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/dns/lookup') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      name?: string;
      type?: 'A' | 'AAAA' | 'MX' | 'TXT' | 'CNAME' | 'NS';
      server?: string;
    };
    const { lookupDns } = await import('@ysk/core');
    const r = await lookupDns({
      host: ctx.host,
      name: data.name ?? '',
      type: data.type ?? 'A',
      server: data.server,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/dns/validate') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      records?: Array<{ type: string; name: string; value: string; ttl?: number }>;
    };
    const { validateDnsRecordSet, hasDnsErrors } = await import('@ysk/core');
    const issues = validateDnsRecordSet(data.records ?? []);
    sendJson(res, 200, {
      ok: !hasDnsErrors(issues),
      issues,
      notes: hasDnsErrors(issues)
        ? [tl('notes.auto.n0649')]
        : issues.length
          ? [tl('notes.auto.n0575')]
          : [tl('notes.auto.n1609')],
    });
    return true;
  }
  // DNSSEC (moved from misc)
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/dns\/zones\/[^/]+\/dnssec$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const zone = decodeURIComponent(url.pathname.split('/')[5] ?? '');
    const { generateDnssecKeys } = await import('@ysk/core');
    const r = await generateDnssecKeys({
      dataDir: ctx.dataDir,
      zone,
      host: ctx.host,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'dns.dnssec.generate',
      resource: zone,
      detail: r,
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/dns\/zones\/[^/]+\/dnssec$/)) {
    ctx.auth.authenticate(getBearer(req));
    const zone = decodeURIComponent(url.pathname.split('/')[5] ?? '');
    const { listDnssecMaterial } = await import('@ysk/core');
    sendJson(res, 200, listDnssecMaterial(ctx.dataDir, zone));
    return true;
  }

  return false;
}
