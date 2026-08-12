/**
 * System apply — PHP + nginx (Wave Y3).
 * Extracted from system-apply-stack.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyPhpHosting,
  applyNginxSite,
} from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSystemApplyWebRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/system/php/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      docRoot?: string;
      phpVersion?: string;
      poolName?: string;
      enableSite?: boolean;
    };
    const result = await applyPhpHosting({
      dataDir: ctx.dataDir,
      domain: data.domain ?? 'php.local',
      docRoot: data.docRoot ?? `${ctx.dataDir}/www/php`,
      phpVersion: data.phpVersion ?? '8.2',
      poolName: data.poolName ?? 'yskphp',
      host: ctx.host,
      enableSite: data.enableSite,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.php.apply',
      detail: result,
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/nginx/purge-cache') {
    const user = ctx.auth.authenticate(getBearer(req));
    const { purgeNginxCache } = await import('@yanshekki/core');
    const r = await purgeNginxCache({ host: ctx.host });
    ctx.audit.append({
      actor: user.username,
      action: 'system.nginx.purge_cache',
      detail: r,
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/nginx/site') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      serverName?: string;
      upstream?: string;
      ssl?: boolean;
      reload?: boolean;
    };
    const result = await applyNginxSite({
      dataDir: ctx.dataDir,
      serverName: data.serverName ?? 'app.local',
      upstream: data.upstream ?? 'http://127.0.0.1:3000',
      ssl: data.ssl,
      host: ctx.host,
      reload: data.reload,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.nginx.site',
      detail: result,
      ok: Boolean(result.ok),
    });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
