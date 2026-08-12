/**
 * Email relay / queue / mailboxes / bootstrap / mail-tls (Wave AC1).
 * Extracted from email-ops.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  writeAllDovecotPassdbs,
  bootstrapEmailServer,
  applySmtpRelay,
  loadSmtpRelaySettings,
} from '@ysk-server/core';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleEmailOpsStackRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/email/relay') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      security?: 'none' | 'starttls' | 'tls';
      domain?: string;
      applySystem?: boolean;
    };
    const result = await applySmtpRelay({
      dataDir: ctx.dataDir,
      host: ctx.host,
      relay: {
        host: data.host ?? '',
        port: data.port ?? 587,
        username: data.username,
        password: data.password,
        security: data.security ?? 'starttls',
        domain: data.domain,
      },
      applySystem: data.applySystem,
      db: ctx.db,
      actor: user.username,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'email.relay.apply',
      detail: { ...result, config: result.config },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/email/relay') {
    ctx.auth.authenticate(getBearer(req));
    const stored = ctx.settings.get('email.smtp_relay');
    sendJson(res, 200, {
      settings: stored ? JSON.parse(stored) : null,
      files: loadSmtpRelaySettings(ctx.dataDir),
    });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/email/queue') {
    ctx.auth.authenticate(getBearer(req));
    const { listMailQueue } = await import('@ysk-server/core');
    sendJson(res, 200, await listMailQueue(ctx.host));
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/email/queue/flush') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { id?: string; all?: boolean };
    const { flushMailQueue } = await import('@ysk-server/core');
    const r = await flushMailQueue(ctx.host, data);
    ctx.audit.append({
      actor: user.username,
      action: 'email.queue.flush',
      detail: data,
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/email/mailboxes') {
    ctx.auth.authenticate(getBearer(req));
    const domainId = (url.searchParams.get('domainId') ?? '').trim();
    type Mb = Record<string, unknown>;
    let all = ctx.email.listMailboxes() as unknown as Mb[];
    if (domainId) {
      all = all.filter(
        (m: Mb) =>
          String(m.domain_id ?? m.domainId ?? '') === domainId ||
          String(m.domain ?? '') === domainId,
      );
    }
    const { items, meta } = listWithQuery(url, all, {
      text: (m: Mb) => [
        String(m.local_part ?? m.localPart ?? ''),
        String(m.address ?? ''),
        String(m.domain ?? ''),
        String(m.id ?? ''),
      ],
    });
    sendJson(res, 200, { items, meta });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/email/dovecot-passdb/all') {
    const user = ctx.auth.authenticate(getBearer(req));
    const result = writeAllDovecotPassdbs({ dataDir: ctx.dataDir, db: ctx.db });
    ctx.audit.append({
      actor: user.username,
      action: 'email.dovecot_passdb.all',
      detail: { domains: result.domains.length },
      ok: result.ok !== false,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/email/mail-tls/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      mailHost?: string;
      applyDovecot?: boolean;
    };
    const { applyMailTlsPaths } = await import('@ysk-server/core');
    const result = await applyMailTlsPaths({
      host: ctx.host,
      domain: data.domain ?? '',
      mailHost: data.mailHost,
      applyDovecot: data.applyDovecot,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'email.mail_tls.apply',
      resource: data.domain,
      detail: { mailHost: result.mailHost, ok: result.ok, applied: result.applied },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/email/bootstrap') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      serverIp?: string;
      mailHostname?: string;
      installPackages?: boolean;
      adminLocalPart?: string;
      adminPassword?: string;
      webmail?: boolean;
      relay?: {
        host: string;
        port?: number;
        username?: string;
        password?: string;
      };
    };
    const result = await bootstrapEmailServer({
      dataDir: ctx.dataDir,
      db: ctx.db,
      host: ctx.host,
      domain: data.domain ?? '',
      serverIp: data.serverIp ?? '',
      mailHostname: data.mailHostname,
      actor: user.username,
      actorUserId: user.id,
      audit: ctx.audit,
      installPackages: data.installPackages,
      adminLocalPart: data.adminLocalPart,
      adminPassword: data.adminPassword,
      webmail: data.webmail,
      relay: data.relay,
      projects: ctx.projects,
      projectOps: ctx.projectOps,
      webmailDownload: true,
    });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
