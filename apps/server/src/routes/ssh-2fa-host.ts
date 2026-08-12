/**
 * SSH 2FA host snippets — PAM / strict sshd / fail2ban (Wave W2).
 * Extracted from ssh-2fa.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { YskError, tl } from '@yanshekki/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSsh2faHostRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/ssh/2fa/pam-snippet') {
    ctx.auth.authenticate(getBearer(req));
    const { buildPamSshSnippet, buildSshdTotpHints, listSsh2fa, planSsh2faStrictSnippet } =
      await import('@yanshekki/core');
    const written = listSsh2fa(ctx.dataDir)
      .filter((i) => i.status === 'file_written')
      .map((i) => i.linuxUser);
    const strict = planSsh2faStrictSnippet({
      linuxUsers: written,
      recoveryUsers: (url.searchParams.get('recovery') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    sendJson(res, 200, {
      ok: true,
      pamSnippet: buildPamSshSnippet(),
      sshdHints: buildSshdTotpHints(),
      strictSnippet: strict.snippet,
      strictUsers: strict.users,
      strictNotes: strict.notes,
      notes: [
        tl('notes.auto.n0350'),
        tl('notes.auto.n0675'),
        tl('notes.auto.n0438'),
        tl('notes.auto.n1344'),
      ],
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/ssh/2fa/strict-apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    if (!user.roles?.includes('admin')) {
      sendJson(res, 403, { ok: false, message: tl('notes.auto.n1559') });
      return true;
    }
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      apply?: boolean;
      recoveryUsers?: string[];
      totp?: string;
    };
    try {
      if (data.apply) ctx.auth.requireStepUp(user.id, data.totp);
    } catch (e) {
      if (e instanceof YskError) {
        sendJson(res, e.httpStatus || 403, {
          ok: false,
          code: e.code,
          message: e.message,
          needsStepUp: true,
        });
        return true;
      }
      throw e;
    }
    const { listSsh2fa, applySshdStrictSnippet } = await import('@yanshekki/core');
    const written = listSsh2fa(ctx.dataDir)
      .filter((i) => i.status === 'file_written')
      .map((i) => i.linuxUser);
    const r = await applySshdStrictSnippet({
      dataDir: ctx.dataDir,
      host: ctx.host,
      linuxUsers: written,
      recoveryUsers: data.recoveryUsers ?? ['root'],
      apply: data.apply === true,
      executeEnabled: ctx.host.executeEnabled(),
    });
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.2fa.strict_apply',
      detail: { apply: data.apply === true, ok: r.ok, users: written },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/security/fail2ban-snippets') {
    ctx.auth.authenticate(getBearer(req));
    const { writeFail2banSnippets } = await import('@yanshekki/core');
    sendJson(res, 200, writeFail2banSnippets(ctx.dataDir));
    return true;
  }

  return false;
}
