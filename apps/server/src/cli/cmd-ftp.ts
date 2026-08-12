/**
 * CLI: ftp — FTPS accounts + service (panel FTP page).
 *
 *   status | settings get|set|apply
 *   accounts list|create|update|delete|apply
 *   options
 */
import {
  listResources,
  createResource,
  updateResource,
  deleteResource,
  getResource,
  loadFtpsSettings,
  saveFtpsSettings,
  probeFtpsStatus,
  applyFtpsService,
  listFtpDomainOptions,
  listFtpHomeOptions,
} from '@yanshekki/core';
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

export async function runFtpCommand(
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
      const status = await probeFtpsStatus({
        db: ctx.db,
        dataDir: ctx.dataDir,
        host: ctx.host,
      });
      h.printJson({ ok: true, ...status });
      return 0;
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  if (sub === 'options') {
    const username = h.getOpt(args, '--username') ?? h.getOpt(args, '--user');
    h.printJson({
      ok: true,
      domains: listFtpDomainOptions(ctx.db),
      homes: listFtpHomeOptions({
        db: ctx.db,
        dataDir: ctx.dataDir,
        username: username ?? undefined,
      }),
    });
    return 0;
  }

  if (sub === 'settings') {
    const action = tokens[2] ?? 'get';
    if (action === 'get' || action === 'show') {
      const settings = loadFtpsSettings(ctx.db);
      let status: unknown = null;
      try {
        status = await probeFtpsStatus({
          db: ctx.db,
          dataDir: ctx.dataDir,
          host: ctx.host,
        });
      } catch {
        /* optional */
      }
      h.printJson({ ok: true, settings, status });
      return 0;
    }
    if (action === 'set' || action === 'patch') {
      const patch: Record<string, unknown> = {};
      const port = h.getOpt(args, '--port');
      if (port) patch.port = Number(port);
      const pasvMin = h.getOpt(args, '--pasv-min');
      if (pasvMin) patch.pasvMin = Number(pasvMin);
      const pasvMax = h.getOpt(args, '--pasv-max');
      if (pasvMax) patch.pasvMax = Number(pasvMax);
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
          'Usage: ysk-server ftp settings set [--port N] [--pasv-min N] [--pasv-max N] [--json-patch {…}]\n',
        );
        return 2;
      }
      const settings = saveFtpsSettings(ctx.db, patch as never);
      h.printJson({ ok: true, settings });
      return 0;
    }
    if (action === 'apply') {
      const blocked = needExecute(
        h,
        args,
        'Pass --execute to apply FTPS service config on the host.',
      );
      if (blocked !== null) return blocked;
      const result = await applyFtpsService({
        db: ctx.db,
        dataDir: ctx.dataDir,
        host: ctx.host,
        applySystem: true,
      });
      h.printJson(result);
      return h.exitFromResult(result);
    }
    process.stderr.write('Usage: ysk-server ftp settings get|set|apply [--execute]\n');
    return 2;
  }

  if (sub === 'accounts' || sub === 'account' || sub === 'list') {
    const action =
      sub === 'list' ? 'list' : (tokens[2] ?? 'list');

    if (action === 'list') {
      const items = listResources(ctx.db, 'ftp_accounts');
      h.printJson({
        ok: true,
        items,
        meta: { total: items.length },
      });
      return 0;
    }

    if (action === 'create' || action === 'add') {
      const username = h.getOpt(args, '--username') ?? h.getOpt(args, '--user') ?? tokens[3];
      const password = h.getOpt(args, '--password');
      const homePath = h.getOpt(args, '--home') ?? h.getOpt(args, '--home-path');
      if (!username?.trim()) {
        process.stderr.write(
          'Usage: ysk-server ftp accounts create --username NAME [--password …] [--home PATH] [--domain …]\n',
        );
        return 2;
      }
      const row = createResource(ctx.db, 'ftp_accounts', {
        username: username.trim(),
        password_plain: password,
        homePath: homePath ?? undefined,
        domain: h.getOpt(args, '--domain') ?? undefined,
      });
      h.printJson({ ok: true, item: row });
      return 0;
    }

    if (action === 'update' || action === 'patch') {
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write(
          'Usage: ysk-server ftp accounts update --id ID [--password …] [--home PATH]\n',
        );
        return 2;
      }
      const patch: Record<string, unknown> = {};
      if (h.getOpt(args, '--password') != null) patch.password_plain = h.getOpt(args, '--password');
      if (h.getOpt(args, '--home') != null) patch.homePath = h.getOpt(args, '--home');
      if (h.getOpt(args, '--home-path') != null) patch.homePath = h.getOpt(args, '--home-path');
      if (h.getOpt(args, '--domain') != null) patch.domain = h.getOpt(args, '--domain');
      if (h.getOpt(args, '--username') != null) patch.username = h.getOpt(args, '--username');
      const item = updateResource(ctx.db, 'ftp_accounts', id.trim(), patch);
      if (!item) {
        h.printJson({ ok: false, notes: ['account not found'] });
        return 4;
      }
      h.printJson({ ok: true, item });
      return 0;
    }

    if (action === 'delete' || action === 'rm' || action === 'remove') {
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server ftp accounts delete --id ID\n');
        return 2;
      }
      const ok = deleteResource(ctx.db, 'ftp_accounts', id.trim());
      h.printJson({ ok });
      return ok ? 0 : 4;
    }

    if (action === 'apply') {
      const blocked = needExecute(
        h,
        args,
        'Pass --execute to apply FTPS accounts to vsftpd on the host.',
      );
      if (blocked !== null) return blocked;
      const id = h.getOpt(args, '--id');
      if (id) {
        const row = getResource(ctx.db, 'ftp_accounts', id);
        if (!row) {
          h.printJson({ ok: false, notes: ['account not found'] });
          return 4;
        }
      }
      const result = await applyFtpsService({
        db: ctx.db,
        dataDir: ctx.dataDir,
        host: ctx.host,
        applySystem: true,
      });
      h.printJson(result);
      return h.exitFromResult(result);
    }

    process.stderr.write(
      'Usage: ysk-server ftp accounts list|create|update|delete|apply [--id …] [--username …] [--execute]\n',
    );
    return 2;
  }

  if (sub === 'apply') {
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to apply FTPS service on the host.',
    );
    if (blocked !== null) return blocked;
    const result = await applyFtpsService({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
      applySystem: true,
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  process.stderr.write(
    'Usage: ysk-server ftp status|settings|accounts|options|apply [--execute] [--json]\n',
  );
  return 2;
}
