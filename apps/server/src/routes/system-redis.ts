/**
 * System Redis service + key browser (Wave AA3).
 * Extracted from system-db-redis.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  installRedisService,
  startRedisService,
  listRedisKeys,
  getRedisKey,
  setRedisString,
  deleteRedisKey,
  loadRedisSettings,
  saveRedisSettings,
  applyRedisServiceConfig,
  getRedisServiceView,
} from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSystemRedisRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— Redis service + browser ——
  if (method === 'GET' && url.pathname === '/api/v1/system/db/redis/status') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, await getRedisServiceView({ db: ctx.db, host: ctx.host }));
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/db/redis/settings') {
    ctx.auth.authenticate(getBearer(req));
    const settings = loadRedisSettings(ctx.db);
    const view = await getRedisServiceView({ db: ctx.db, host: ctx.host });
    sendJson(res, 200, { settings, status: view });
    return true;
  }
  if (method === 'PUT' && url.pathname === '/api/v1/system/db/redis/settings') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const settings = saveRedisSettings(ctx.db, data);
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.redis.settings.save',
      detail: { databases: settings.databases },
      ok: true,
    });
    sendJson(res, 200, { ok: true, settings });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/redis/settings/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { settings?: Record<string, unknown>; restart?: boolean };
    const result = await applyRedisServiceConfig({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
      settings: data.settings as object,
      restart: data.restart !== false,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.redis.settings.apply',
      detail: { ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/redis/install') {
    const user = ctx.auth.authenticate(getBearer(req));
    const result = await installRedisService({ host: ctx.host, dataDir: ctx.dataDir });
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.redis.install',
      detail: { ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/redis/start') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      exposureDecision?: 'keep-private' | 'public' | 'restricted';
      allowFrom?: string[];
    };
    const result = await startRedisService(ctx.host);
    if (result.ok) {
      try {
        const { syncServiceExposure, dbPortBindings } = await import('@yanshekki/core');
        const exp = await syncServiceExposure({
          host: ctx.host,
          dataDir: ctx.dataDir,
          serviceId: 'redis',
          ports: dbPortBindings('redis'),
          reason: 'start',
          exposureDecision: data.exposureDecision,
          allowFrom: data.allowFrom,
          requireDecision: true,
        });
        if (exp.notes?.length) {
          (result as { notes?: string[] }).notes = [
            ...((result as { notes?: string[] }).notes ?? []),
            ...exp.notes.slice(0, 4),
          ];
        }
        if (exp.needsExposureDecision) {
          (result as { needsExposureDecision?: boolean }).needsExposureDecision = true;
        }
      } catch {
        /* non-fatal */
      }
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.redis.start',
      detail: { ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  // Content browser — must stay under /api/v1/system/* (handler gate below protection)
  if (method === 'GET' && url.pathname === '/api/v1/system/redis/keys') {
    ctx.auth.authenticate(getBearer(req));
    const db = Number(url.searchParams.get('db') ?? 0);
    const pattern = url.searchParams.get('pattern') ?? '*';
    const count = Number(url.searchParams.get('count') ?? 100);
    try {
      const result = await listRedisKeys({ host: ctx.host, db, pattern, count });
      sendOpsResult(res, result);
    } catch (e) {
      sendJson(res, 400, {
        ok: false,
        notes: [e instanceof Error ? e.message : 'list failed'],
        keys: [],
      });
    }
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/redis/key') {
    ctx.auth.authenticate(getBearer(req));
    const db = Number(url.searchParams.get('db') ?? 0);
    const key = url.searchParams.get('key') ?? '';
    try {
      const result = await getRedisKey({ host: ctx.host, db, key });
      sendOpsResult(res, result, { notFound: true });
    } catch (e) {
      sendJson(res, 400, { ok: false, notes: [e instanceof Error ? e.message : 'get failed'] });
    }
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/redis/key') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      db?: number;
      key?: string;
      value?: string;
      ttl?: number;
    };
    try {
      const result = await setRedisString({
        host: ctx.host,
        db: data.db,
        key: String(data.key ?? ''),
        value: String(data.value ?? ''),
        ttl: data.ttl,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'redis.key.set',
        detail: { key: data.key, db: data.db, ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, result);
    } catch (e) {
      sendJson(res, 400, {
        ok: false,
        notes: [e instanceof Error ? e.message : 'set failed'],
      });
    }
    return true;
  }
  if (method === 'DELETE' && url.pathname === '/api/v1/system/redis/key') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { db?: number; key?: string };
    try {
      const result = await deleteRedisKey({
        host: ctx.host,
        db: data.db,
        key: String(data.key ?? ''),
      });
      ctx.audit.append({
        actor: user.username,
        action: 'redis.key.del',
        detail: { key: data.key, db: data.db, ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, result);
    } catch (e) {
      sendJson(res, 400, {
        ok: false,
        notes: [e instanceof Error ? e.message : 'del failed'],
      });
    }
    return true;
  }

  return false;
}
