/**
 * Email webmail SSO, sieve, SSO plugin (Wave W1).
 * Extracted from email-webmail.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleEmailWebmailSsoRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // D7: bind existing LE cert paths into Postfix/Dovecot (does not run certbot)
  if (method === 'POST' && url.pathname === '/api/v1/email/webmail/sso') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      email?: string;
      domain?: string;
      ttlMinutes?: number;
      password?: string;
      webmailBaseUrl?: string;
    };
    const { issueWebmailSso } = await import('@ysk/core');
    const r = issueWebmailSso({
      db: ctx.db,
      email: data.email ?? '',
      domain: data.domain ?? '',
      ttlMinutes: data.ttlMinutes,
      password: data.password,
      webmailBaseUrl: data.webmailBaseUrl,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'email.webmail.sso',
      resource: data.email,
      detail: { ok: r.ok, expiresAt: r.expiresAt, hasPassword: Boolean(data.password) },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/email/webmail/sso/consume') {
    // Used by webmail edge / test — token in body; rate-limit guesses
    const { checkRateLimit, recordRateLimitFailure, clearRateLimit, consumeWebmailSso } =
      await import('@ysk/core');
    const ip =
      process.env.YSK_TRUST_PROXY === '1' || process.env.YSK_TRUST_PROXY === 'true'
        ? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
          req.socket.remoteAddress ||
          'local'
        : req.socket.remoteAddress || 'local';
    const rlKey = `sso:${ip}`;
    const gate = checkRateLimit('webmail-sso', rlKey, {
      maxFailures: 20,
      windowMs: 15 * 60_000,
      lockMs: 15 * 60_000,
    });
    if (!gate.ok) {
      sendJson(res, 429, {
        ok: false,
        message: 'rate limited',
        retryAfterSec: gate.retryAfterSec,
      });
      return true;
    }
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { token?: string };
    const r = consumeWebmailSso(ctx.db, data.token ?? '');
    if (!r.ok) recordRateLimitFailure('webmail-sso', rlKey);
    else clearRateLimit('webmail-sso', rlKey);
    // Unauthorized token → 401 (not ops blocked); success still honest envelope
    if (!r.ok) {
      sendJson(res, 401, { ok: false, notes: r.notes, code: 'YSK_UNAUTHORIZED' });
      return true;
    }
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/email/sieve') {
    ctx.auth.authenticate(getBearer(req));
    const mailbox = url.searchParams.get('mailbox') ?? '';
    const { listSieveScripts } = await import('@ysk/core');
    sendJson(res, 200, { items: listSieveScripts(ctx.dataDir, mailbox) });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/email/sieve') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      mailbox?: string;
      name?: string;
      content?: string;
    };
    const { writeSieveScript } = await import('@ysk/core');
    const r = writeSieveScript({
      dataDir: ctx.dataDir,
      mailbox: data.mailbox ?? '',
      name: data.name,
      content: data.content ?? '',
    });
    ctx.audit.append({
      actor: user.username,
      action: 'email.sieve.write',
      resource: data.mailbox,
      detail: r,
      ok: r.ok,
    });
    sendJson(res, 200, r);
    return true;
  }
  if (method === 'DELETE' && url.pathname === '/api/v1/email/sieve') {
    const user = ctx.auth.authenticate(getBearer(req));
    const mailbox = url.searchParams.get('mailbox') ?? '';
    const name = url.searchParams.get('name') ?? '';
    const { deleteSieveScript } = await import('@ysk/core');
    const r = deleteSieveScript(ctx.dataDir, mailbox, name);
    ctx.audit.append({
      actor: user.username,
      action: 'email.sieve.delete',
      resource: mailbox,
      detail: r,
      ok: r.ok,
    });
    sendOpsResult(res, r, { notFound: true });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/email/webmail/sso-plugin') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      panelBaseUrl?: string;
      enableSystem?: boolean;
      roundcubePluginsDir?: string;
    };
    const panelBase =
      data.panelBaseUrl || `http://127.0.0.1:${process.env.YSK_PORT || process.env.PORT || 9287}`;
    if (data.enableSystem) {
      const { enableRoundcubeSsoPlugin } = await import('@ysk/core');
      const r = await enableRoundcubeSsoPlugin({
        dataDir: ctx.dataDir,
        host: ctx.host,
        panelBaseUrl: panelBase,
        roundcubePluginsDir: data.roundcubePluginsDir,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'email.webmail.sso_plugin.enable',
        detail: r,
        ok: r.ok,
      });
      sendOpsResult(res, r);
      return true;
    }
    const { writeRoundcubeSsoPlugin } = await import('@ysk/core');
    const r = writeRoundcubeSsoPlugin({
      dataDir: ctx.dataDir,
      panelBaseUrl: panelBase,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'email.webmail.sso_plugin',
      detail: r,
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  return false;
}
