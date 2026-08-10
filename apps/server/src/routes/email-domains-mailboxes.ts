/**
 * Email domain mailboxes / aliases / dovecot passdb (Wave S2).
 * Extracted from email-domains-ops.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeDovecotPassdb } from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleEmailDomainsMailboxesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    sendJson(res, 200, { items: ctx.email.listMailboxes(id) });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      localPart?: string;
      password?: string;
      provisionSystem?: boolean;
    };
    const result = await ctx.email.createMailbox(id, {
      localPart: data.localPart ?? '',
      password: data.password,
      provisionSystem: data.provisionSystem,
      actor: user.username,
      actorUserId: user.id,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    sendJson(res, 200, { items: ctx.email.listAliases(id) });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      type?: 'alias' | 'forward' | 'catchall';
      localPart?: string;
      destinations?: string[];
    };
    const result = ctx.email.createAlias(id, {
      type: data.type ?? 'forward',
      localPart: data.localPart,
      destinations: data.destinations ?? [],
      actor: user.username });
    sendJson(res, 201, result);
    return true;
  }
  if (
    method === 'PATCH' &&
    url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes\/[^/]+$/)
  ) {
    const user = ctx.auth.authenticate(getBearer(req));
    const parts = url.pathname.split('/');
    const domainId = parts[5] ?? '';
    const mailboxId = parts[7] ?? '';
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      password?: string;
      status?: 'active' | 'disabled';
    };
    const result = await ctx.email.updateMailbox(domainId, mailboxId, {
      actor: user.username,
      password: data.password,
      status: data.status,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes\/[^/]+$/)
  ) {
    const user = ctx.auth.authenticate(getBearer(req));
    const parts = url.pathname.split('/');
    const domainId = parts[5] ?? '';
    const mailboxId = parts[7] ?? '';
    const result = await ctx.email.deleteMailbox(domainId, mailboxId, user.username);
    ctx.audit.append({
      actor: user.username,
      action: 'email.mailbox.delete',
      resource: result.address,
      detail: { domainId, mailboxId },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases\/[^/]+$/)
  ) {
    const user = ctx.auth.authenticate(getBearer(req));
    const parts = url.pathname.split('/');
    const id = parts[5];
    const aliasId = parts[7];
    const result = ctx.email.deleteAlias(id, aliasId, user.username);
    sendJson(res, 200, result);
    return true;
  }
  if (
    method === 'POST' &&
    url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/dovecot-passdb$/)
  ) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const domain = ctx.email.get(id);
    const result = writeDovecotPassdb({
      dataDir: ctx.dataDir,
      db: ctx.db,
      domain: domain.domain,
      domainId: id });
    ctx.audit.append({
      actor: user.username,
      action: 'email.dovecot_passdb',
      resource: domain.domain,
      detail: { mailboxCount: result.mailboxCount, written: result.written },
      ok: result.ok });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
