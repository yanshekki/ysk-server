/**
 * System export, rebuild, migrate, readiness fix.
 * Extracted from system-ops.ts (Wave L1). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import {
  hardenDataDirPerms,
  ensureWebUiBuilt,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { VERSION } from '../version.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSystemMigrateRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— Control-plane export + managed nginx + rebuild ——
  // Must live here: handleSystemRoutes is invoked before inline http-server routes.
  if (method === 'GET' && url.pathname === '/api/v1/system/export') {
    ctx.auth.authenticate(getBearer(req));
    const { exportControlPlaneSnapshot } = await import('@ysk/core');
    sendJson(res, 200, exportControlPlaneSnapshot(ctx.db));
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/exports') {
    ctx.auth.authenticate(getBearer(req));
    const { listControlPlaneExports } = await import('@ysk/core');
    sendJson(res, 200, { items: listControlPlaneExports(ctx.dataDir) });
    return true;
  }
  if (method === 'GET' && url.pathname.startsWith('/api/v1/system/exports/')) {
    ctx.auth.authenticate(getBearer(req));
    const name = decodeURIComponent(url.pathname.split('/').pop() || '');
    const { resolveExportFile } = await import('@ysk/core');
    const { createReadStream, existsSync } = await import('node:fs');
    const r = resolveExportFile(ctx.dataDir, name);
    if (!r.ok || !existsSync(r.path)) {
      sendJson(res, 404, { ok: false, notes: r.ok ? [tl('notes.auto.n0496')] : r.notes });
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    createReadStream(r.path).pipe(res);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/managed-nginx') {
    ctx.auth.authenticate(getBearer(req));
    const { listManagedNginxDetailed } = await import('@ysk/core');
    const { listWithQuery } = await import('../http/list-response.js');
    const all = listManagedNginxDetailed(ctx.dataDir) as Array<Record<string, unknown>>;
    const { items, meta } = listWithQuery(url, all, {
      text: (n) => [
        String(n.name ?? n.file ?? n.id ?? ''),
        String(n.domain ?? n.serverName ?? ''),
        String(n.path ?? ''),
      ],
    });
    sendJson(res, 200, { items, meta });
    return true;
  }
  if (method === 'GET' && url.pathname.startsWith('/api/v1/system/managed-nginx/')) {
    ctx.auth.authenticate(getBearer(req));
    const name = decodeURIComponent(url.pathname.split('/').pop() || '');
    const { readManagedNginxConf } = await import('@ysk/core');
    const r = readManagedNginxConf(ctx.dataDir, name);
    sendOpsResult(res, r, { notFound: true });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/rebuild') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      syncNginx?: boolean;
      writeExport?: boolean;
      dryRun?: boolean;
    };
    const { rebuildManagedConfigs } = await import('@ysk/core');
    const r = await rebuildManagedConfigs({
      dataDir: ctx.dataDir,
      host: ctx.host,
      db: ctx.db,
      syncNginx: data.syncNginx,
      writeExport: data.writeExport !== false,
      dryRun: data.dryRun === true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.rebuild',
      detail: {
        ok: r.ok,
        mode: r.mode,
        blocked: r.blocked,
        dryRun: r.dryRun,
        confCount: r.nginxConfs?.length,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  // —— Host full migrate (整機遷移) ——
  if (method === 'POST' && url.pathname === '/api/v1/system/migrate/inventory') {
    ctx.auth.authenticate(getBearer(req));
    const { migrateInventory } = await import('@ysk/core');
    const r = await migrateInventory({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      yskVersion: VERSION,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/migrate/jobs') {
    ctx.auth.authenticate(getBearer(req));
    const { listMigrateJobs } = await import('@ysk/core');
    sendJson(res, 200, { ok: true, jobs: listMigrateJobs(ctx.dataDir) });
    return true;
  }

  if (method === 'GET' && url.pathname.startsWith('/api/v1/system/migrate/jobs/')) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/').pop() || '';
    const { loadMigrateJob } = await import('@ysk/core');
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

    const { runSourceMigrateHost, loadMigrateJob } = await import('@ysk/core');
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
    const { runLocalMigratePost } = await import('@ysk/core');
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



  if (method === 'POST' && url.pathname === '/api/v1/system/readiness/fix') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { action?: string };
    const action = String(data.action ?? '').trim();
    if (!action) {
      sendJson(res, 400, { ok: false, notes: ['action required'] });
      return true;
    }
    if (action === 'harden-datadir') {
      const result = hardenDataDirPerms(ctx.dataDir);
      ctx.audit.append({
        actor: user.username,
        action: 'system.readiness.fix',
        detail: {
          fixAction: action,
          path: result.path,
          before: result.before,
          after: result.after,
          notes: result.notes,
        },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        action,
        path: result.path,
        before: result.before,
        after: result.after,
        notes: result.notes,
      });
      return true;
    }
    if (action === 'build-web-ui') {
      const result = await ensureWebUiBuilt({ dataDir: ctx.dataDir });
      ctx.audit.append({
        actor: user.username,
        action: 'system.readiness.fix',
        detail: {
          fixAction: action,
          path: result.path,
          notes: result.notes,
          codes: result.codes,
        },
        ok: result.ok,
      });
      // Prefer localized operator message when monorepo/package missing
      const notes =
        result.ok || !result.codes?.includes('NO_MONOREPO')
          ? result.notes
          : [
              tl('readiness.itemWebBuildManual'),
              ...result.notes,
            ];
      sendOpsResult(res, {
        ok: result.ok,
        action,
        path: result.path,
        notes,
        codes: result.codes,
      });
      return true;
    }
    sendJson(res, 400, {
      ok: false,
      notes: [`unknown readiness fix action: ${action}`],
      action,
    });
    return true;
  }



  return false;
}
