/**
 * SSH login 2FA vault — enroll / confirm / install / reveal (Wave W2).
 * Extracted from ssh-2fa.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSsh2faVaultRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— SSH login 2FA (TOTP/PAM; independent of panel operator 2FA) ——
  if (method === 'GET' && url.pathname === '/api/v1/ssh/2fa') {
    ctx.auth.authenticate(getBearer(req));
    const { listSsh2fa, probeSsh2faHost } = await import('@ysk/core');
    const items = listSsh2fa(ctx.dataDir, {
      projectId: url.searchParams.get('projectId') ?? undefined,
      linuxUser: url.searchParams.get('linuxUser') ?? undefined,
    });
    const hostProbe = await probeSsh2faHost(ctx.host).catch(() => ({
      notes: ['host probe skipped'],
    }));
    sendJson(res, 200, { ok: true, items, host: hostProbe });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/ssh/2fa') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      projectId?: string;
      linuxUser?: string;
      homeDir?: string;
      /** advanced: copy panel operator secret */
      fromPanel?: boolean;
    };
    const { enrollSsh2fa } = await import('@ysk/core');
    let secret: string | undefined;
    let fromPanel = false;
    if (data.fromPanel === true) {
      if (!user.roles?.includes('admin')) {
        sendJson(res, 403, {
          ok: false,
          code: 'YSK_FORBIDDEN',
          message: tl('notes.auto.n0293'),
        });
        return true;
      }
      const me = ctx.db.snapshot.users.find((u) => u.id === user.id);
      if (!me?.totp_secret) {
        sendJson(res, 422, {
          ok: false,
          notes: [tl('notes.auto.n0364')],
        });
        return true;
      }
      try {
        ctx.auth.requireStepUp(user.id); // need recent step-up or fail
      } catch {
        sendJson(res, 403, {
          ok: false,
          needsStepUp: true,
          notes: [tl('notes.auto.n0294')],
        });
        return true;
      }
      const { decryptTotpSecret } = await import('@ysk/core');
      secret = decryptTotpSecret(ctx.dataDir, user.id, me.totp_secret);
      fromPanel = true;
    }
    const r = enrollSsh2fa(
      ctx.dataDir,
      {
        projectId: data.projectId,
        linuxUser: data.linuxUser,
        homeDir: data.homeDir,
        createdBy: user.username,
        secret,
        fromPanel,
      },
      ctx.db,
    );
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.2fa.enroll',
      resource: r.record?.id,
      detail: {
        linuxUser: r.record?.linuxUser,
        fromPanel,
        ok: r.ok,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/confirm$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { code?: string };
    const { confirmSsh2fa } = await import('@ysk/core');
    const r = confirmSsh2fa(ctx.dataDir, id, data.code ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.2fa.confirm',
      resource: id,
      detail: { ok: r.ok },
      ok: r.ok });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/install$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { apply?: boolean };
    const { installSsh2faFile } = await import('@ysk/core');
    const r = await installSsh2faFile({
      dataDir: ctx.dataDir,
      id,
      apply: data.apply === true,
      host: ctx.host,
      executeEnabled: ctx.host.executeEnabled() });
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.2fa.install',
      resource: id,
      detail: { apply: data.apply === true, applied: r.applied, ok: r.ok },
      ok: r.ok });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/uninstall$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { apply?: boolean };
    const { uninstallSsh2faFile } = await import('@ysk/core');
    const r = await uninstallSsh2faFile({
      dataDir: ctx.dataDir,
      id,
      apply: data.apply === true,
      retire: true });
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.2fa.uninstall',
      resource: id,
      detail: { ok: r.ok },
      ok: r.ok });
    sendOpsResult(res, r, { notFound: true });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/reveal$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    if (!user.roles?.includes('admin')) {
      sendJson(res, 403, { ok: false, code: 'YSK_FORBIDDEN', message: tl('notes.auto.n0561') });
      return true;
    }
    const id = url.pathname.split('/')[5];
    const { revealSsh2faSecret } = await import('@ysk/core');
    const r = revealSsh2faSecret(ctx.dataDir, id);
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.2fa.reveal',
      resource: id,
      detail: { ok: r.ok },
      ok: r.ok });
    sendOpsResult(res, r, { notFound: true });
    return true;
  }
  if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const { retireSsh2fa, uninstallSsh2faFile } = await import('@ysk/core');
    if (url.searchParams.get('purgeFile') === '1') {
      await uninstallSsh2faFile({ dataDir: ctx.dataDir, id, apply: true, retire: true });
    } else {
      retireSsh2fa(ctx.dataDir, id);
    }
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.2fa.retire',
      resource: id,
      detail: {},
      ok: true });
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
