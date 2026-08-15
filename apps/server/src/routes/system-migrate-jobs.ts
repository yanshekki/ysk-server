/**
 * Host migrate inventory / jobs / post (Wave X1).
 * Extracted from system-migrate-host.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import { VERSION } from '../version.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSystemMigrateJobsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— Host full migrate (整機遷移) ——
  if (method === 'POST' && url.pathname === '/api/v1/system/migrate/inventory') {
    ctx.auth.authenticate(getBearer(req));
    const { migrateInventory } = await import('ysk-server-core');
    const r = await migrateInventory({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      yskVersion: VERSION,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/migrate/orphan-homes') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { path?: string; confirmPath?: string };
    const { removeOrphanProjectHome } = await import('ysk-server-core');
    const r = await removeOrphanProjectHome({
      host: ctx.host,
      db: ctx.db,
      path: data.path ?? '',
      confirmPath: data.confirmPath ?? '',
    });
    ctx.audit.append({
      actor: user.username,
      action: 'migrate.orphan_home.remove',
      detail: { path: data.path, ok: r.ok },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/migrate/jobs') {
    ctx.auth.authenticate(getBearer(req));
    const { listMigrateJobs } = await import('ysk-server-core');
    sendJson(res, 200, { ok: true, jobs: listMigrateJobs(ctx.dataDir) });
    return true;
  }

  if (method === 'GET' && url.pathname.startsWith('/api/v1/system/migrate/jobs/')) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/').pop() || '';
    const { loadMigrateJob } = await import('ysk-server-core');
    const job = loadMigrateJob(ctx.dataDir, id);
    if (!job) {
      sendJson(res, 404, { ok: false, notes: [tl('notes.auto.n0853')] });
      return true;
    }
    sendJson(res, 200, { ok: true, job });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/migrate/jobs') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      target?: string;
      port?: number;
      identityId?: string;
      identityFile?: string;
      /** one-shot; never stored */
      password?: string;
      maintenanceAccepted?: boolean;
      forceWipeTarget?: boolean;
      targetDataDir?: string;
      dryRun?: boolean;
      skipRemotePost?: boolean;
      jobId?: string;
      execute?: boolean;
    };
    const target = (data.target || '').trim();
    if (!target && !data.jobId) {
      sendJson(res, 400, {
        ok: false,
        notes: [tl('notes.auto.n1573')],
      });
      return true;
    }
    if (!data.execute && !data.dryRun) {
      sendJson(res, 403, {
        ok: false,
        blocked: true,
        notes: [tl('notes.auto.n1544')],
      });
      return true;
    }
    if (data.execute && !ctx.host.executeEnabled()) {
      sendOpsResult(res, {
        ok: false,
        blocked: true,
        requiresExecute: true,
        notes: [tl('notes.auto.n0525')],
      });
      return true;
    }

    const { runSourceMigrateHost, loadMigrateJob } = await import('ysk-server-core');
    type Auth =
      | { kind: 'identity'; privateKeyPath: string }
      | { kind: 'identityId'; dataDir: string; identityId: string }
      | { kind: 'password'; password: string }
      | { kind: 'agent' };
    let auth: Auth = { kind: 'agent' };
    let passwordForTempKey: string | undefined;
    if (data.identityFile) {
      auth = { kind: 'identity', privateKeyPath: data.identityFile };
    } else if (data.identityId) {
      auth = {
        kind: 'identityId',
        dataDir: ctx.dataDir,
        identityId: data.identityId,
      };
    } else if (data.password) {
      passwordForTempKey = data.password;
      auth = { kind: 'agent' };
    }

    let targetStr = target;
    if (!targetStr && data.jobId) {
      const prev = loadMigrateJob(ctx.dataDir, data.jobId);
      if (prev?.target) {
        targetStr = `${prev.target.user}@${prev.target.host}`;
        if (!data.port && prev.target.port) data.port = prev.target.port;
      }
    }
    if (!targetStr) {
      sendJson(res, 400, {
        ok: false,
        notes: [tl('notes.auto.n1574')],
      });
      return true;
    }

    const r = await runSourceMigrateHost({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      target: targetStr,
      port: data.port,
      auth,
      passwordForTempKey,
      maintenanceAccepted: data.maintenanceAccepted === true || data.execute === true,
      forceWipeTarget: data.forceWipeTarget === true,
      targetDataDir: data.targetDataDir,
      dryRun: data.dryRun === true,
      remotePost: data.skipRemotePost !== true,
      yskVersion: VERSION,
      jobId: data.jobId,
    });

    ctx.audit.append({
      actor: user.username,
      action: 'system.migrate.host',
      detail: {
        ok: r.ok,
        blocked: r.blocked,
        jobId: r.job?.id,
        target: target || undefined,
        dryRun: data.dryRun === true,
        phase: r.job?.phase,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/migrate/post') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { jobId?: string };
    if (!data.jobId) {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n1563')] });
      return true;
    }
    if (!ctx.host.executeEnabled()) {
      sendOpsResult(res, {
        ok: false,
        blocked: true,
        requiresExecute: true,
        notes: [tl('notes.auto.n0332')],
      });
      return true;
    }
    const { runLocalMigratePost } = await import('ysk-server-core');
    const r = await runLocalMigratePost({
      host: ctx.host,
      dataDir: ctx.dataDir,
      jobId: data.jobId,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.migrate.post',
      detail: { ok: r.ok, jobId: data.jobId },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  return false;
}
