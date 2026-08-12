/**
 * SSH identity vault CRUD — list/create/import/export/get/delete (Wave S3).
 * Extracted from ssh-identities.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { YskError, tl } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSshIdentitiesCrudRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— SSH identity vault (outbound private keys; distinct from sftp authorized_keys) ——
  if (method === 'GET' && url.pathname === '/api/v1/ssh/identities') {
    ctx.auth.authenticate(getBearer(req));
    const { listSshIdentities } = await import('ysk-server-core');
    const purposeRaw = url.searchParams.get('purpose') ?? undefined;
    const purpose =
      purposeRaw === 'user_outbound' ||
      purposeRaw === 'panel_outbound' ||
      purposeRaw === 'unbound'
        ? purposeRaw
        : undefined;
    sendJson(res, 200, {
      ok: true,
      items: listSshIdentities(ctx.dataDir, {
        projectId: url.searchParams.get('projectId') ?? undefined,
        linuxUser: url.searchParams.get('linuxUser') ?? undefined,
        purpose,
      }),
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/ssh/identities') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      name?: string;
      comment?: string;
      algorithm?: 'ed25519' | 'rsa-4096';
      purpose?: 'user_outbound' | 'panel_outbound' | 'unbound';
      binding?: { projectId?: string; linuxUser?: string; homeDir?: string };
      revealPrivate?: boolean;
      install?: boolean;
    };
    const { createSshIdentity, installSshIdentity } = await import('ysk-server-core');
    const r = createSshIdentity(
      ctx.dataDir,
      {
        name: data.name ?? '',
        comment: data.comment,
        algorithm: data.algorithm,
        purpose: data.purpose,
        binding: data.binding,
        createdBy: user.username,
        revealPrivate: data.revealPrivate === true,
      },
      ctx.db,
    );
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.identity.create',
      resource: r.identity?.id,
      detail: {
        name: data.name,
        purpose: data.purpose,
        fingerprint: r.identity?.fingerprintSha256,
        ok: r.ok,
      },
      ok: r.ok,
    });
    if (r.ok && data.install && r.identity) {
      const inst = await installSshIdentity({
        dataDir: ctx.dataDir,
        id: r.identity.id,
        apply: true,
        host: ctx.host,
        executeEnabled: ctx.host.executeEnabled(),
      });
      sendJson(res, r.ok ? 201 : 422, { ...r, install: inst });
      return true;
    }
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/ssh/identities/import') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      name?: string;
      privateKey?: string;
      comment?: string;
      purpose?: 'user_outbound' | 'panel_outbound' | 'unbound';
      binding?: { projectId?: string; linuxUser?: string; homeDir?: string };
    };
    const { importSshIdentity } = await import('ysk-server-core');
    const r = importSshIdentity(
      ctx.dataDir,
      {
        name: data.name ?? '',
        privateKey: data.privateKey ?? '',
        comment: data.comment,
        purpose: data.purpose,
        binding: data.binding,
        createdBy: user.username,
      },
      ctx.db,
    );
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.identity.import',
      resource: r.identity?.id,
      detail: {
        name: data.name,
        fingerprint: r.identity?.fingerprintSha256,
        ok: r.ok,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/public$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const { getSshIdentity } = await import('ysk-server-core');
    const identity = getSshIdentity(ctx.dataDir, id);
    if (!identity) {
      sendJson(res, 404, { ok: false, message: tl('notes.ssh.identityNotFound') });
      return true;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.statusCode = 200;
    res.end(identity.publicKey.endsWith('\n') ? identity.publicKey : identity.publicKey + '\n');
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/export$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    if (!user.roles?.includes('admin')) {
      sendJson(res, 403, {
        ok: false,
        code: 'YSK_FORBIDDEN',
        message: tl('notes.auto.n0281') });
      return true;
    }
    const rawBody = await readBody(req).catch(() => '{}');
    const expData = JSON.parse(rawBody || '{}') as { totp?: string };
    try {
      ctx.auth.requireStepUp(user.id, expData.totp);
    } catch (e) {
      if (e instanceof YskError) {
        sendJson(res, e.httpStatus || 403, {
          ok: false,
          code: e.code,
          message: e.message,
          needsStepUp: true });
        return true;
      }
      throw e;
    }
    const id = url.pathname.split('/')[5];
    const { exportSshIdentityPrivate } = await import('ysk-server-core');
    const r = exportSshIdentityPrivate(ctx.dataDir, id);
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.identity.export',
      resource: id,
      detail: { fingerprint: r.fingerprintSha256, ok: r.ok },
      ok: r.ok });
    sendOpsResult(res, r, { notFound: true });
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const { getSshIdentity } = await import('ysk-server-core');
    const identity = getSshIdentity(ctx.dataDir, id);
    if (!identity) {
      sendJson(res, 404, { ok: false, message: tl('notes.ssh.identityNotFound') });
      return true;
    }
    sendJson(res, 200, { ok: true, identity });
    return true;
  }
  if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const purgeDisk = url.searchParams.get('purgeDisk') === '1';
    const { deleteSshIdentity, uninstallSshIdentity } = await import('ysk-server-core');
    if (purgeDisk) {
      await uninstallSshIdentity({
        dataDir: ctx.dataDir,
        id,
        apply: true,
        purgeFiles: true });
    }
    const r = deleteSshIdentity(ctx.dataDir, id);
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.identity.delete',
      resource: id,
      detail: { purgeDisk, ok: r.ok },
      ok: r.ok });
    sendOpsResult(res, r, { notFound: true });
    return true;
  }

  return false;
}
