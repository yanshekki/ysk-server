/**
 * CLI: ssl panel-tls — panel control-plane HTTPS (System → Panel TLS).
 *
 *   ssl panel-tls status|enable|disable|issue
 */
import {
  getPanelTlsStatus,
  enablePanelTls,
  disablePanelTls,
  issueAndEnablePanelTls,
  tryRestartPanelService,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';

export async function runPanelTlsCommand(
  ctx: AppContext,
  args: string[],
  h: CliHelpers,
): Promise<number> {
  const tokens = args.filter((a) => !a.startsWith('-'));
  // tokens: ssl panel-tls <action>  OR panel-tls <action>
  let action = 'status';
  const pti = tokens.indexOf('panel-tls');
  if (pti >= 0) action = tokens[pti + 1] ?? 'status';
  else if (tokens[0] === 'panel-tls') action = tokens[1] ?? 'status';

  if (action === 'status' || action === 'get' || action === 'info') {
    const st = getPanelTlsStatus({
      config: ctx.config,
      servingHttps: false,
    });
    h.printJson({
      ...st,
      ok: true,
      configPath: ctx.configPath ?? null,
      notes: [
        'servingHttps is false in CLI (no live HTTP socket); check tlsEnabled + cert paths.',
      ],
    });
    return 0;
  }

  if (action === 'enable') {
    if (!ctx.configPath) {
      h.printJson({ ok: false, notes: ['No config path — set --config or data-dir with config.json'] });
      return 2;
    }
    const domain =
      h.getOpt(args, '--domain')?.trim() || ctx.config?.panelDomain || '';
    const r = enablePanelTls({
      configPath: ctx.configPath,
      dataDir: ctx.dataDir,
      domain,
      certPath: h.getOpt(args, '--cert'),
      keyPath: h.getOpt(args, '--key'),
      enabled: true,
    });
    const notes = [...r.notes];
    if (r.ok && !h.hasFlag(args, '--no-restart')) {
      if (h.wantsHostExecute(args)) {
        const rs = await tryRestartPanelService(ctx.host);
        notes.push(...rs.notes);
      } else {
        notes.push('Pass --execute to restart panel service after enable.');
      }
    }
    h.printJson({ ...r, notes, ok: r.ok });
    return r.ok ? 0 : 1;
  }

  if (action === 'disable') {
    if (!ctx.configPath) {
      h.printJson({ ok: false, notes: ['No config path'] });
      return 2;
    }
    const r = disablePanelTls({ configPath: ctx.configPath });
    const notes = [...r.notes];
    if (r.ok && !h.hasFlag(args, '--no-restart') && h.wantsHostExecute(args)) {
      const rs = await tryRestartPanelService(ctx.host);
      notes.push(...rs.notes);
    }
    h.printJson({ ...r, notes, ok: r.ok });
    return r.ok ? 0 : 1;
  }

  if (action === 'issue') {
    if (!ctx.configPath) {
      h.printJson({ ok: false, notes: ['No config path'] });
      return 2;
    }
    if (!h.wantsHostExecute(args)) {
      h.printJson({
        ok: false,
        blocked: true,
        dryRun: true,
        notes: [
          'Pass --execute (and YSK_EXECUTE=1) to issue ACME cert and enable panel TLS on the host.',
        ],
      });
      return 3;
    }
    const domain =
      h.getOpt(args, '--domain')?.trim() || ctx.config?.panelDomain || '';
    if (!domain) {
      process.stderr.write(
        'Usage: ysk-server ssl panel-tls issue --domain example.com [--email …] --execute\n',
      );
      return 2;
    }
    const email =
      h.getOpt(args, '--email')?.trim() ||
      `admin@${domain.replace(/^\*\./, '')}` ||
      'admin@localhost';
    const r = await issueAndEnablePanelTls({
      configPath: ctx.configPath,
      dataDir: ctx.dataDir,
      db: ctx.db,
      host: ctx.host,
      domain,
      email,
      actor: 'cli',
    });
    const notes = [...r.notes];
    if (r.ok && !h.hasFlag(args, '--no-restart')) {
      const rs = await tryRestartPanelService(ctx.host);
      notes.push(...rs.notes);
    }
    h.printJson({ ...r, notes, ok: r.ok });
    return h.exitFromResult(r);
  }

  process.stderr.write(
    'Usage: ysk-server ssl panel-tls status|enable|disable|issue [--domain …] [--execute]\n',
  );
  return 2;
}
