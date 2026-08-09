/**
 * System DB engines, console, SQL switch, Redis browser, dump/import.
 * Extracted from system-controller (Wave D1). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  installDbEngine,
  startDbEngine,
  unfreezeDbEngine,
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
  loadSqlSettings,
  saveSqlSettings,
  applySqlServiceConfig,
  getSqlServiceView,
  loadPostgresSettings,
  savePostgresSettings,
  applyPostgresServiceConfig,
  getPostgresServiceView,
  getServiceConsole,
  lifecycleService,
  applyConsoleSettings,
  installServiceEngine,
  previewSqlEngineSwitch,
  switchSqlEngine,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSystemDbRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— Professional service console (all engines) ——
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb|postgres|redis)\/console$/)) {
    ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb' | 'postgres' | 'redis';
    const consoleDto = await getServiceConsole(ctx.host, engine, ctx.db);
    sendJson(res, 200, consoleDto);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb|postgres|redis)\/console\/apply$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb' | 'postgres' | 'redis';
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { changes?: Record<string, string> };
    const result = await applyConsoleSettings({
      host: ctx.host,
      engine,
      changes: data.changes ?? {},
    });
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.console.apply`,
      detail: { ok: result.ok, applied: result.applied },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb|postgres|redis)\/lifecycle$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb' | 'postgres' | 'redis';
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { action?: string };
    const action = data.action as 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable';
    const result = await lifecycleService(ctx.host, engine, action);
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.lifecycle`,
      detail: { action, ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb|postgres|redis)\/install$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb' | 'postgres' | 'redis';
    // prefer console install for postgres (catalog); mysql/redis already had install routes
    if (engine === 'postgres' || engine === 'mysql' || engine === 'mariadb' || engine === 'redis') {
      const result = await installServiceEngine(ctx.host, engine, ctx.dataDir);
      ctx.audit.append({
        actor: user.username,
        action: `system.db.${engine}.install`,
        detail: { ok: result.ok, code: result.code },
        ok: result.ok,
      });
      sendOpsResult(res, result);
      return true;
    }
  }

  // —— SQL engine exclusive switch (MySQL XOR MariaDB) ——
  if (method === 'GET' && url.pathname === '/api/v1/system/db/sql-engine/switch-preview') {
    ctx.auth.authenticate(getBearer(req));
    const target = (url.searchParams.get('target') || '') as 'mysql' | 'mariadb';
    if (target !== 'mysql' && target !== 'mariadb') {
      sendJson(res, 400, { ok: false, message: 'target must be mysql|mariadb' });
      return true;
    }
    const preview = await previewSqlEngineSwitch({
      host: ctx.host,
      target,
      dataDir: ctx.dataDir,
    });
    sendJson(res, 200, preview);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/sql-engine/switch') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      target?: string;
      confirmPhrase?: string;
      acknowledgeExclusive?: boolean;
      migrateData?: boolean;
      rootPassword?: string;
    };
    const target = data.target as 'mysql' | 'mariadb';
    if (target !== 'mysql' && target !== 'mariadb') {
      sendJson(res, 400, { ok: false, message: 'target must be mysql|mariadb' });
      return true;
    }
    const result = await switchSqlEngine({
      host: ctx.host,
      dataDir: ctx.dataDir,
      target,
      confirmPhrase: String(data.confirmPhrase ?? ''),
      acknowledgeExclusive: data.acknowledgeExclusive === true,
      migrateData: data.migrateData !== false,
      rootPassword: typeof data.rootPassword === 'string' ? data.rootPassword : undefined,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.sql_engine.switch',
      detail: {
        target,
        ok: result.ok,
        code: result.code,
        dumpPath: result.dumpPath,
      },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  // —— MySQL / MariaDB engine ——
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/status$/)) {
    ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    sendJson(res, 200, await getSqlServiceView({ db: ctx.db, host: ctx.host, engine }));
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/settings$/)) {
    ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const settings = loadSqlSettings(ctx.db, engine);
    const status = await getSqlServiceView({ db: ctx.db, host: ctx.host, engine });
    sendJson(res, 200, { settings, status });
    return true;
  }
  if (method === 'PUT' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/settings$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const settings = saveSqlSettings(ctx.db, engine, data);
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.settings.save`,
      detail: { port: settings.port },
      ok: true,
    });
    sendJson(res, 200, { ok: true, settings });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/settings\/apply$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { settings?: Record<string, unknown>; restart?: boolean };
    const result = await applySqlServiceConfig({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
      engine,
      settings: data.settings as object,
      restart: data.restart !== false,
    });
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.settings.apply`,
      detail: { ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/db/postgres/status') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, await getPostgresServiceView({ db: ctx.db, host: ctx.host }));
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/db/postgres/settings') {
    ctx.auth.authenticate(getBearer(req));
    const settings = loadPostgresSettings(ctx.db);
    const status = await getPostgresServiceView({ db: ctx.db, host: ctx.host });
    sendJson(res, 200, { settings, status });
    return true;
  }
  if (method === 'PUT' && url.pathname === '/api/v1/system/db/postgres/settings') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const settings = savePostgresSettings(ctx.db, data);
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.postgres.settings.save',
      detail: { port: settings.port },
      ok: true,
    });
    sendJson(res, 200, { ok: true, settings });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/postgres/settings/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { settings?: Record<string, unknown>; restart?: boolean };
    const result = await applyPostgresServiceConfig({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
      settings: data.settings as object,
      restart: data.restart !== false,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.db.postgres.settings.apply',
      detail: { ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/install$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const result = await installDbEngine({
      host: ctx.host,
      engine,
      dataDir: ctx.dataDir,
    });
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.install`,
      detail: { ok: result.ok, blocked: result.blocked },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/start$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const result = await startDbEngine({ host: ctx.host, engine });
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.start`,
      detail: { ok: result.ok, code: result.code },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb)\/unfreeze$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const engine = url.pathname.split('/')[5] as 'mysql' | 'mariadb';
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { confirm?: boolean };
    const result = await unfreezeDbEngine({
      host: ctx.host,
      engine,
      confirm: data.confirm === true,
    });
    ctx.audit.append({
      actor: user.username,
      action: `system.db.${engine}.unfreeze`,
      detail: { ok: result.ok, code: result.code },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

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
    const result = await startRedisService(ctx.host);
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


  if (method === 'POST' && url.pathname === '/api/v1/system/db/dump') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      engine?: 'mysql' | 'mariadb' | 'postgres';
      dbName?: string;
      username?: string;
      password?: string;
    };
    const { dumpSqlDatabase } = await import('@ysk/core');
    const r = await dumpSqlDatabase({
      host: ctx.host,
      dataDir: ctx.dataDir,
      engine: data.engine ?? 'mysql',
      dbName: data.dbName ?? '',
      username: data.username,
      password: data.password,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'db.dump',
      detail: { engine: data.engine, dbName: data.dbName, ok: r.ok },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/db/dumps') {
    ctx.auth.authenticate(getBearer(req));
    const { listSqlDumps } = await import('@ysk/core');
    const engine = url.searchParams.get('engine') as 'mysql' | 'mariadb' | 'postgres' | null;
    sendJson(res, 200, { items: listSqlDumps(ctx.dataDir, engine || undefined) });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/db/import') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      engine?: 'mysql' | 'mariadb' | 'postgres';
      dbName?: string;
      sqlPath?: string;
      name?: string;
      username?: string;
      password?: string;
    };
    const { importSqlDatabase, listSqlDumps } = await import('@ysk/core');
    let sqlPath = data.sqlPath ?? '';
    if (!sqlPath && data.name) {
      const found = listSqlDumps(ctx.dataDir, data.engine).find((d) => d.name === data.name);
      sqlPath = found?.path ?? '';
    }
    const r = await importSqlDatabase({
      host: ctx.host,
      engine: data.engine ?? 'mysql',
      dbName: data.dbName ?? '',
      sqlPath,
      username: data.username,
      password: data.password,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'db.import',
      detail: { engine: data.engine, dbName: data.dbName, ok: r.ok },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }


  return false;
}
