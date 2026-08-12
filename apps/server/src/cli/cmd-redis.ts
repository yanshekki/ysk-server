/**
 * CLI: redis — service + key browser (panel Redis page).
 *
 *   status | install | start | settings get|set|apply
 *   keys | get | set | del
 *
 * Lifecycle also via: ysk-server db lifecycle --engine redis …
 */
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
  syncServiceExposure,
  dbPortBindings,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';

function needExecute(
  h: CliHelpers,
  args: string[],
  msg: string,
): number | null {
  if (h.wantsHostExecute(args)) return null;
  h.printJson({ ok: false, blocked: true, dryRun: true, notes: [msg] });
  return 3;
}

export async function runRedisCommand(
  ctx: AppContext,
  args: string[],
  _json: boolean,
  h: CliHelpers,
): Promise<number> {
  void _json;
  const tokens = args.filter((a) => !a.startsWith('-'));
  const sub = tokens[1] ?? 'status';

  if (sub === 'status' || sub === 'info') {
    try {
      const view = await getRedisServiceView({ db: ctx.db, host: ctx.host });
      h.printJson({ ok: true, ...view });
      return 0;
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  if (sub === 'install') {
    const blocked = needExecute(h, args, 'Pass --execute to install Redis packages.');
    if (blocked !== null) return blocked;
    const result = await installRedisService({ host: ctx.host, dataDir: ctx.dataDir });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'start') {
    const blocked = needExecute(h, args, 'Pass --execute to start Redis.');
    if (blocked !== null) return blocked;
    const result = await startRedisService(ctx.host);
    if (result.ok) {
      try {
        const decisionRaw = h.getOpt(args, '--exposure-decision') ?? h.getOpt(args, '--decision');
        const exposureDecision =
          decisionRaw === 'keep-private' ||
          decisionRaw === 'public' ||
          decisionRaw === 'restricted'
            ? decisionRaw
            : undefined;
        const allowFrom = h
          .getOpt(args, '--allow-from')
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const exp = await syncServiceExposure({
          host: ctx.host,
          dataDir: ctx.dataDir,
          serviceId: 'redis',
          ports: dbPortBindings('redis'),
          reason: 'start',
          exposureDecision,
          allowFrom,
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
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'settings') {
    const action = tokens[2] ?? 'get';
    if (action === 'get' || action === 'show') {
      const settings = loadRedisSettings(ctx.db);
      let status: unknown = null;
      try {
        status = await getRedisServiceView({ db: ctx.db, host: ctx.host });
      } catch {
        /* optional */
      }
      h.printJson({ ok: true, settings, status });
      return 0;
    }
    if (action === 'set' || action === 'patch') {
      const patch: Record<string, unknown> = {};
      const databases = h.getOpt(args, '--databases');
      if (databases) patch.databases = Number(databases);
      const maxmemory = h.getOpt(args, '--maxmemory');
      if (maxmemory) patch.maxmemory = maxmemory;
      const bind = h.getOpt(args, '--bind');
      if (bind) patch.bind = bind;
      const port = h.getOpt(args, '--port');
      if (port) patch.port = Number(port);
      const jsonPatch = h.getOpt(args, '--json-patch') ?? h.getOpt(args, '--patch');
      if (jsonPatch) {
        try {
          Object.assign(patch, JSON.parse(jsonPatch));
        } catch {
          process.stderr.write('--json-patch must be JSON object\n');
          return 2;
        }
      }
      if (Object.keys(patch).length === 0) {
        process.stderr.write(
          'Usage: ysk-server redis settings set [--port N] [--bind …] [--databases N] [--json-patch {…}]\n',
        );
        return 2;
      }
      const settings = saveRedisSettings(ctx.db, patch);
      h.printJson({ ok: true, settings });
      return 0;
    }
    if (action === 'apply') {
      const blocked = needExecute(
        h,
        args,
        'Pass --execute to apply Redis config on the host.',
      );
      if (blocked !== null) return blocked;
      const result = await applyRedisServiceConfig({
        db: ctx.db,
        dataDir: ctx.dataDir,
        host: ctx.host,
        restart: !h.hasFlag(args, '--no-restart'),
      });
      h.printJson(result);
      return h.exitFromResult(result);
    }
    process.stderr.write('Usage: ysk-server redis settings get|set|apply [--execute]\n');
    return 2;
  }

  if (sub === 'keys' || sub === 'list') {
    const db = Number(h.getOpt(args, '--db') ?? 0);
    const pattern = h.getOpt(args, '--pattern') ?? '*';
    const count = Number(h.getOpt(args, '--count') ?? 100);
    try {
      const result = await listRedisKeys({
        host: ctx.host,
        db: Number.isFinite(db) ? db : 0,
        pattern,
        count: Number.isFinite(count) ? count : 100,
      });
      h.printJson(result);
      return result.ok ? 0 : 1;
    } catch (e) {
      h.printJson({
        ok: false,
        keys: [],
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  if (sub === 'get' || sub === 'get-key') {
    const db = Number(h.getOpt(args, '--db') ?? 0);
    const key = h.getOpt(args, '--key') ?? tokens[2];
    if (!key?.trim()) {
      process.stderr.write('Usage: ysk-server redis get --key NAME [--db 0]\n');
      return 2;
    }
    try {
      const result = await getRedisKey({
        host: ctx.host,
        db: Number.isFinite(db) ? db : 0,
        key: key.trim(),
      });
      h.printJson(result);
      return result.ok ? 0 : 4;
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  if (sub === 'set' || sub === 'set-key') {
    // Setting keys is a data mutation; require --execute for honesty with host write path
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to SET a Redis key on the host.',
    );
    if (blocked !== null) return blocked;
    const db = Number(h.getOpt(args, '--db') ?? 0);
    const key = h.getOpt(args, '--key') ?? tokens[2];
    const value = h.getOpt(args, '--value') ?? tokens[3];
    if (!key?.trim() || value == null) {
      process.stderr.write(
        'Usage: ysk-server redis set --key NAME --value TEXT [--ttl SEC] [--db 0] --execute\n',
      );
      return 2;
    }
    const ttlRaw = h.getOpt(args, '--ttl');
    const ttl = ttlRaw != null ? Number(ttlRaw) : undefined;
    try {
      const result = await setRedisString({
        host: ctx.host,
        db: Number.isFinite(db) ? db : 0,
        key: key.trim(),
        value,
        ttl: Number.isFinite(ttl) ? ttl : undefined,
      });
      h.printJson(result);
      return h.exitFromResult(result);
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  if (sub === 'del' || sub === 'delete' || sub === 'rm') {
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to DELETE a Redis key on the host.',
    );
    if (blocked !== null) return blocked;
    const db = Number(h.getOpt(args, '--db') ?? 0);
    const key = h.getOpt(args, '--key') ?? tokens[2];
    if (!key?.trim()) {
      process.stderr.write('Usage: ysk-server redis del --key NAME [--db 0] --execute\n');
      return 2;
    }
    try {
      const result = await deleteRedisKey({
        host: ctx.host,
        db: Number.isFinite(db) ? db : 0,
        key: key.trim(),
      });
      h.printJson(result);
      return h.exitFromResult(result);
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  process.stderr.write(
    'Usage: ysk-server redis status|install|start|settings|keys|get|set|del [--execute] [--json]\n',
  );
  return 2;
}
