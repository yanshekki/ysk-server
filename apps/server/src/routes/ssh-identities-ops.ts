/**
 * SSH identity host ops — install/uninstall/test/rotate/authorize-self (Wave S3).
 * Extracted from ssh-identities.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendOpsResult,
} from '../http/util.js';

export async function handleSshIdentitiesOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/install$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { apply?: boolean };
    const { installSshIdentity } = await import('ysk-server-core');
    const r = await installSshIdentity({
      dataDir: ctx.dataDir,
      id,
      apply: data.apply === true,
      host: ctx.host,
      executeEnabled: ctx.host.executeEnabled() });
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.identity.install',
      resource: id,
      detail: {
        apply: data.apply === true,
        applied: r.applied,
        path: r.plannedPath,
        ok: r.ok },
      ok: r.ok });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/uninstall$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { apply?: boolean; purgeFiles?: boolean };
    const { uninstallSshIdentity } = await import('ysk-server-core');
    const r = await uninstallSshIdentity({
      dataDir: ctx.dataDir,
      id,
      apply: data.apply === true,
      purgeFiles: data.purgeFiles !== false });
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.identity.uninstall',
      resource: id,
      detail: { apply: data.apply === true, ok: r.ok },
      ok: r.ok });
    sendOpsResult(res, r, { notFound: true });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/test$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { target?: string; apply?: boolean };
    const { testSshIdentity } = await import('ysk-server-core');
    const r = await testSshIdentity({
      dataDir: ctx.dataDir,
      id,
      target: data.target ?? '',
      apply: data.apply === true,
      host: ctx.host,
      executeEnabled: ctx.host.executeEnabled() });
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.identity.test',
      resource: id,
      detail: {
        target: data.target,
        apply: data.apply === true,
        ok: r.ok,
        dryRun: r.dryRun },
      ok: r.ok });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/rotate$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { revealPrivate?: boolean };
    const { rotateSshIdentity } = await import('ysk-server-core');
    const r = rotateSshIdentity({
      dataDir: ctx.dataDir,
      id,
      revealPrivate: data.revealPrivate === true,
      db: ctx.db });
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.identity.rotate',
      resource: id,
      detail: {
        newId: r.newIdentity?.id,
        fingerprint: r.newIdentity?.fingerprintSha256,
        ok: r.ok },
      ok: r.ok });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/authorize-self$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const { authorizeSelfSshIdentity } = await import('ysk-server-core');
    const r = await authorizeSelfSshIdentity({
      dataDir: ctx.dataDir,
      db: ctx.db,
      id,
      host: ctx.host });
    ctx.audit.append({
      actor: user.username,
      action: 'ssh.identity.authorize_self',
      resource: id,
      detail: { keyId: r.keyId, ok: r.ok },
      ok: r.ok });
    sendOpsResult(res, r);
    return true;
  }

  return false;
}
