/**
 * Service console / lifecycle / multi-engine install / SQL switch (Wave U3).
 * Extracted from system-db-engines.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getServiceConsole,
  lifecycleService,
  applyConsoleSettings,
  installServiceEngine,
  previewSqlEngineSwitch,
  switchSqlEngine,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';
import { requireAnyCap } from '../http/rbac-guard.js';

const DB_CONSOLE_READ_CAPS = [
  'mysql.console.write',
  'services.control',
  'settings.system',
] as const;

export async function handleSystemDbConsoleRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— Professional service console (all engines) ——
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/system\/db\/(mysql|mariadb|postgres|redis)\/console$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    requireAnyCap(ctx, user, DB_CONSOLE_READ_CAPS);
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
    const changes = data.changes ?? {};
    const result = await applyConsoleSettings({
      host: ctx.host,
      engine,
      changes,
    });
    // Port change → migrate firewall rules for this service
    if (result.ok && Object.keys(changes).some((k) => /port/i.test(k))) {
      try {
        const { syncServiceExposure, engineToServiceId, dbPortBindings } = await import(
          'ysk-server-core'
        );
        const exp = await syncServiceExposure({
          host: ctx.host,
          dataDir: ctx.dataDir,
          serviceId: engineToServiceId(engine),
          ports: dbPortBindings(engine, changes),
          reason: 'port-change',
          requireDecision: false,
        });
        if (exp.notes.length) result.notes.push(...exp.notes.slice(0, 4));
      } catch {
        /* non-fatal */
      }
    }
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
    const data = JSON.parse(raw || '{}') as {
      action?: string;
      /** Private services: decision before/with start */
      exposureDecision?: 'keep-private' | 'public' | 'restricted';
      allowFrom?: string[];
    };
    const action = data.action as 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable';
    const result = await lifecycleService(ctx.host, engine, action);
    // Auto firewall sync after lifecycle (private DBs stay closed unless decided)
    if (result.ok && (action === 'start' || action === 'stop' || action === 'restart')) {
      try {
        const { syncServiceExposure, engineToServiceId, dbPortBindings } = await import(
          'ysk-server-core'
        );
        const reason = action === 'stop' ? 'stop' : 'start';
        const exp = await syncServiceExposure({
          host: ctx.host,
          dataDir: ctx.dataDir,
          serviceId: engineToServiceId(engine),
          ports: dbPortBindings(engine),
          reason,
          exposureDecision: data.exposureDecision,
          allowFrom: data.allowFrom,
          requireDecision: action === 'start' || action === 'restart',
        });
        if (exp.notes.length) result.notes.push(...exp.notes.slice(0, 4));
        if (exp.needsExposureDecision) {
          (result as { needsExposureDecision?: boolean }).needsExposureDecision = true;
        }
        if (exp.blocked) {
          result.notes.push(...(exp.notes ?? []).slice(0, 2));
        }
      } catch {
        /* non-fatal */
      }
    }
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
      const result = await installServiceEngine(ctx.host, engine, ctx.dataDir, ctx.db);
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
    const user = ctx.auth.authenticate(getBearer(req));
    requireAnyCap(ctx, user, DB_CONSOLE_READ_CAPS);
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

  return false;
}
