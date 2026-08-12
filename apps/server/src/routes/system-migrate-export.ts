/**
 * System export, managed nginx, rebuild (Wave R2).
 * Extracted from system-migrate.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSystemMigrateExportRoutes(
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
    const { exportControlPlaneSnapshot } = await import('ysk-server-core');
    sendJson(res, 200, exportControlPlaneSnapshot(ctx.db));
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/exports') {
    ctx.auth.authenticate(getBearer(req));
    const { listControlPlaneExports } = await import('ysk-server-core');
    sendJson(res, 200, { items: listControlPlaneExports(ctx.dataDir) });
    return true;
  }
  if (method === 'GET' && url.pathname.startsWith('/api/v1/system/exports/')) {
    ctx.auth.authenticate(getBearer(req));
    const name = decodeURIComponent(url.pathname.split('/').pop() || '');
    const { resolveExportFile } = await import('ysk-server-core');
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
    const { listManagedNginxDetailed } = await import('ysk-server-core');
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
    const { readManagedNginxConf } = await import('ysk-server-core');
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
    const { rebuildManagedConfigs } = await import('ysk-server-core');
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

  return false;
}
