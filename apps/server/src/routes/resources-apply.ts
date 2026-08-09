/**
 * Managed resource apply actions (Wave S1).
 * Extracted from resources.ts. Behaviour preserved.
 */
import { tl } from '@ysk/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyManagedNginxSite,
  applyMysqlDatabase,
  applyPostgresDatabase,
  applyRedisInstance,
  applyDnsZone,
  type CollectionKey,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { readBody, sendJson, sendOpsResult } from '../http/util.js';

export async function handleResourcesApplyRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  method: string,
  _user: { username: string },
  key: CollectionKey,
  id: string | null,
  action: string | null,
  _prefix: string,
): Promise<boolean> {
  // APPLY
  if (method === 'POST' && id && action === 'apply') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { execute?: boolean };
    // Panel always executes unless explicitly dry-run
    const execute = data.execute !== false;

    if (key === 'nginx_sites') {
      const r = await applyManagedNginxSite(ctx.db, ctx.dataDir, id, {
        host: ctx.host,
        execute,
        systemConfDir: '/etc/nginx/conf.d' });
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'mysql_databases') {
      const r = await applyMysqlDatabase(ctx.db, id, ctx.host, execute);
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'postgres_databases') {
      const r = await applyPostgresDatabase(ctx.db, id, ctx.host, execute);
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'redis_instances') {
      const r = await applyRedisInstance(ctx.db, id, ctx.host, execute);
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'dns_zones') {
      const r = await applyDnsZone(ctx.db, ctx.dataDir, id, {
        host: ctx.host,
        validate: true,
        tryReload: execute });
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'ftp_accounts') {
      const { applyFtpAccountReal } = await import('@ysk/core');
      const r = await applyFtpAccountReal({
        db: ctx.db,
        dataDir: ctx.dataDir,
        host: ctx.host,
        id });
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'certificates') {
      sendJson(res, 410, {
        ok: false,
        notes: ['Use POST /api/v1/ssl/upload or /api/v1/ssl/letsencrypt — marking applied is disabled'] });
      return true;
    }

    sendJson(res, 400, { ok: false, message: tl('notes.auto.n1040') });
    return true;
  }

  return false;
}
