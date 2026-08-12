/**
 * CLI: db — service console / lifecycle / sql-engine switch (panel DB consoles).
 *
 *   status|console|apply|lifecycle|install  --engine mysql|mariadb|postgres|redis
 *   sql-engine preview|switch --target mysql|mariadb
 *
 * Cluster fleet remains: ysk-server db-cluster …
 * Hosting provision remains: ysk-server hosting …-provision
 */
import {
  getServiceConsole,
  lifecycleService,
  applyConsoleSettings,
  installServiceEngine,
  previewSqlEngineSwitch,
  switchSqlEngine,
  probeDbEngine,
  syncServiceExposure,
  engineToServiceId,
  dbPortBindings,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';

type Engine = 'mysql' | 'mariadb' | 'postgres' | 'redis';

function parseEngine(raw: string | undefined): Engine | null {
  if (raw === 'mysql' || raw === 'mariadb' || raw === 'postgres' || raw === 'redis') {
    return raw;
  }
  return null;
}

function needExecute(
  h: CliHelpers,
  args: string[],
  msg: string,
): number | null {
  if (h.wantsHostExecute(args)) return null;
  h.printJson({ ok: false, blocked: true, dryRun: true, notes: [msg] });
  return 3;
}

function engineFromArgs(h: CliHelpers, args: string[], tokens: string[], at = 2): Engine | null {
  return parseEngine(
    h.getOpt(args, '--engine') ?? h.getOpt(args, '--id') ?? tokens[at],
  );
}

export async function runDbCommand(
  ctx: AppContext,
  args: string[],
  _json: boolean,
  h: CliHelpers,
): Promise<number> {
  void _json;
  const tokens = args.filter((a) => !a.startsWith('-'));
  const sub = tokens[1] ?? 'status';

  if (sub === 'status' || sub === 'info') {
    const engine = engineFromArgs(h, args, tokens, 2);
    if (!engine) {
      // Overview: SQL engines via probe + full console snapshot per service
      const items: unknown[] = [];
      for (const e of ['mysql', 'mariadb'] as const) {
        try {
          items.push({ ...(await probeDbEngine(ctx.host, e)), engine: e });
        } catch (err) {
          items.push({
            engine: e,
            ok: false,
            notes: [err instanceof Error ? err.message : String(err)],
          });
        }
      }
      for (const e of ['postgres', 'redis'] as const) {
        try {
          const c = await getServiceConsole(ctx.host, e, ctx.db);
          items.push({ ...c, engine: e });
        } catch (err) {
          items.push({
            engine: e,
            ok: false,
            notes: [err instanceof Error ? err.message : String(err)],
          });
        }
      }
      h.printJson({ ok: true, items });
      return 0;
    }
    try {
      if (engine === 'mysql' || engine === 'mariadb') {
        const st = await probeDbEngine(ctx.host, engine);
        h.printJson({ ...st, ok: true, engine });
        return 0;
      }
      const c = await getServiceConsole(ctx.host, engine, ctx.db);
      h.printJson({ ...c, ok: true, engine });
      return 0;
    } catch (e) {
      h.printJson({
        ok: false,
        engine,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  if (sub === 'console' || sub === 'get') {
    const engine = engineFromArgs(h, args, tokens, 2);
    if (!engine) {
      process.stderr.write(
        'Usage: ysk-server db console --engine mysql|mariadb|postgres|redis\n',
      );
      return 2;
    }
    try {
      const consoleDto = await getServiceConsole(ctx.host, engine, ctx.db);
      h.printJson({ ...consoleDto, ok: true, engine });
      return 0;
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  if (sub === 'apply' || sub === 'console-apply') {
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to apply DB console settings on the host.',
    );
    if (blocked !== null) return blocked;
    const engine = engineFromArgs(h, args, tokens, 2);
    if (!engine) {
      process.stderr.write(
        'Usage: ysk-server db apply --engine ENGINE --set key=value [--set k2=v2] --execute\n',
      );
      return 2;
    }
    const changes: Record<string, string> = {};
    // --set key=value (repeatable)
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--set' && args[i + 1] && !args[i + 1]!.startsWith('-')) {
        const pair = args[i + 1]!;
        const eq = pair.indexOf('=');
        if (eq > 0) changes[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
    }
    const changesJson = h.getOpt(args, '--changes');
    if (changesJson) {
      try {
        Object.assign(changes, JSON.parse(changesJson) as Record<string, string>);
      } catch {
        process.stderr.write('--changes must be JSON object\n');
        return 2;
      }
    }
    if (Object.keys(changes).length === 0) {
      process.stderr.write('Provide at least one --set key=value or --changes JSON\n');
      return 2;
    }
    const result = await applyConsoleSettings({
      host: ctx.host,
      engine,
      changes,
    });
    if (result.ok && Object.keys(changes).some((k) => /port/i.test(k))) {
      try {
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
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'lifecycle' || sub === 'start' || sub === 'stop' || sub === 'restart' || sub === 'reload' || sub === 'enable' || sub === 'disable') {
    const action =
      sub === 'lifecycle'
        ? (h.getOpt(args, '--action') ?? tokens[2] ?? 'status')
        : sub;
    if (
      action !== 'start' &&
      action !== 'stop' &&
      action !== 'restart' &&
      action !== 'reload' &&
      action !== 'enable' &&
      action !== 'disable'
    ) {
      process.stderr.write(
        'Usage: ysk-server db lifecycle --engine ENGINE --action start|stop|restart|reload|enable|disable --execute\n',
      );
      return 2;
    }
    const blocked = needExecute(
      h,
      args,
      `Pass --execute to ${action} the database service on the host.`,
    );
    if (blocked !== null) return blocked;
    const engine = engineFromArgs(
      h,
      args,
      tokens,
      sub === 'lifecycle' ? 3 : 2,
    );
    if (!engine) {
      process.stderr.write(
        `Usage: ysk-server db ${sub === 'lifecycle' ? 'lifecycle --action ACTION' : sub} --engine ENGINE --execute\n`,
      );
      return 2;
    }
    const result = await lifecycleService(ctx.host, engine, action);
    if (result.ok && (action === 'start' || action === 'stop' || action === 'restart')) {
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
          serviceId: engineToServiceId(engine),
          ports: dbPortBindings(engine),
          reason: action === 'stop' ? 'stop' : 'start',
          exposureDecision,
          allowFrom,
          requireDecision: action === 'start' || action === 'restart',
        });
        if (exp.notes.length) result.notes.push(...exp.notes.slice(0, 4));
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

  if (sub === 'install') {
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to install the database engine packages on the host.',
    );
    if (blocked !== null) return blocked;
    const engine = engineFromArgs(h, args, tokens, 2);
    if (!engine) {
      process.stderr.write(
        'Usage: ysk-server db install --engine mysql|mariadb|postgres|redis --execute\n',
      );
      return 2;
    }
    const result = await installServiceEngine(ctx.host, engine, ctx.dataDir);
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'sql-engine' || sub === 'sql') {
    const action = tokens[2] ?? 'preview';
    const targetRaw = h.getOpt(args, '--target') ?? tokens[3];
    const target =
      targetRaw === 'mysql' || targetRaw === 'mariadb' ? targetRaw : null;

    if (action === 'preview' || action === 'switch-preview') {
      if (!target) {
        process.stderr.write(
          'Usage: ysk-server db sql-engine preview --target mysql|mariadb\n',
        );
        return 2;
      }
      const preview = await previewSqlEngineSwitch({
        host: ctx.host,
        target,
        dataDir: ctx.dataDir,
      });
      h.printJson({ ...preview, ok: preview.ok !== false });
      return preview.ok === false ? 1 : 0;
    }

    if (action === 'switch') {
      const blocked = needExecute(
        h,
        args,
        'Pass --execute to switch MySQL↔MariaDB on the host (destructive exclusive).',
      );
      if (blocked !== null) return blocked;
      if (!target) {
        process.stderr.write(
          'Usage: ysk-server db sql-engine switch --target mysql|mariadb --confirm PHRASE --acknowledge-exclusive --execute\n',
        );
        return 2;
      }
      const confirmPhrase = h.getOpt(args, '--confirm') ?? h.getOpt(args, '--confirm-phrase') ?? '';
      if (!confirmPhrase) {
        process.stderr.write('Missing --confirm PHRASE (from preview.confirmPhrase)\n');
        return 2;
      }
      if (!h.hasFlag(args, '--acknowledge-exclusive')) {
        process.stderr.write('Pass --acknowledge-exclusive to confirm exclusive engine switch\n');
        return 2;
      }
      const result = await switchSqlEngine({
        host: ctx.host,
        dataDir: ctx.dataDir,
        target,
        confirmPhrase,
        acknowledgeExclusive: true,
        migrateData: !h.hasFlag(args, '--no-migrate'),
        rootPassword: h.getOpt(args, '--root-password') ?? undefined,
      });
      h.printJson(result);
      return h.exitFromResult(result);
    }

    process.stderr.write(
      'Usage: ysk-server db sql-engine preview|switch --target mysql|mariadb [--execute]\n',
    );
    return 2;
  }

  process.stderr.write(
    'Usage: ysk-server db status|console|apply|lifecycle|install|sql-engine [--engine …] [--execute]\n' +
      'Also: db-cluster …  hosting mysql-provision|postgres-provision|redis-provision\n',
  );
  return 2;
}
