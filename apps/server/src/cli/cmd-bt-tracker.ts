/**
 * CLI: bt-tracker — self-hosted BitTorrent tracker for file shares.
 */
import {
  getBtTrackerStatus,
  startBtTracker,
  stopBtTracker,
  loadBtTrackerSettings,
  patchBtTrackerSettings,
  listBtTrackerTorrents,
  collectBtShareStats,
  getFileShareById,
  listFileShares,
  normalizeDownloadModes,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';

export async function runBtTrackerCommand(
  ctx: AppContext,
  args: string[],
  _json: boolean,
  h: CliHelpers,
): Promise<number> {
  void _json;
  const tokens = args.filter((a) => !a.startsWith('-'));
  const sub = tokens[1] ?? 'status';

  if (sub === 'status' || sub === 'info') {
    const st = await getBtTrackerStatus({
      dataDir: ctx.dataDir,
      host: ctx.host,
    });
    h.printJson({ ok: true, ...st });
    return st.running ? 0 : 0;
  }

  if (sub === 'settings') {
    const act = tokens[2] ?? 'get';
    if (act === 'get' || act === 'show') {
      h.printJson({ ok: true, settings: loadBtTrackerSettings(ctx.dataDir) });
      return 0;
    }
    if (act === 'set' || act === 'patch') {
      const patch: Record<string, unknown> = {};
      const httpPort = h.getOpt(args, '--http-port');
      if (httpPort) patch.httpPort = Number(httpPort);
      const udpPort = h.getOpt(args, '--udp-port');
      if (udpPort != null) patch.udpPort = Number(udpPort);
      const host = h.getOpt(args, '--listen-host');
      if (host) patch.listenHost = host;
      const pub = h.getOpt(args, '--public-host');
      if (pub != null) patch.publicAnnounceHost = pub;
      if (h.hasFlag(args, '--ws')) patch.wsEnabled = true;
      if (h.hasFlag(args, '--no-ws')) patch.wsEnabled = false;
      if (h.hasFlag(args, '--autostart')) patch.autostart = true;
      if (h.hasFlag(args, '--no-autostart')) patch.autostart = false;
      const settings = patchBtTrackerSettings(ctx.dataDir, patch as never);
      h.printJson({ ok: true, settings });
      return 0;
    }
    process.stderr.write(
      'Usage: ysk-server bt-tracker settings get|set [--http-port N] [--public-host H]\n',
    );
    return 2;
  }

  if (sub === 'start') {
    if (!h.wantsHostExecute(args) && process.env.YSK_EXECUTE !== '1') {
      h.printJson({
        ok: false,
        blocked: true,
        dryRun: true,
        notes: [
          'Pass --execute (and YSK_EXECUTE=1) to start tracker in production.',
          'Prefer panel Start or enable autostart so the tracker runs inside `ysk-server serve`.',
        ],
      });
      return 3;
    }
    const r = await startBtTracker({ dataDir: ctx.dataDir, host: ctx.host });
    // CLI is a short-lived process — tracker dies when this process exits unless serve holds it.
    // When operators use CLI against a live panel, use the HTTP API / panel UI instead.
    if (r.ok) {
      r.notes = [
        ...(r.notes || []),
        'Tracker is in-process: keep this process alive, or use panel Start / autostart with `ysk-server serve`.',
      ];
    }
    h.printJson(r);
    return h.exitFromResult(r);
  }

  if (sub === 'stop') {
    const r = await stopBtTracker();
    h.printJson(r);
    return r.ok ? 0 : 1;
  }

  if (sub === 'torrents' || sub === 'stats') {
    const items = listBtTrackerTorrents();
    h.printJson({
      ok: true,
      items,
      meta: { total: items.length },
    });
    return 0;
  }

  process.stderr.write(
    'Usage: ysk-server bt-tracker status|start|stop|settings|torrents [--execute] [--json]\n',
  );
  return 2;
}

/** files shares bt-stats helper used from files command path if needed */
export async function printShareBtStats(
  ctx: AppContext,
  shareId: string,
  h: CliHelpers,
): Promise<number> {
  const share = getFileShareById(ctx.db, shareId);
  if (!share) {
    h.printJson({ ok: false, notes: ['share not found'] });
    return 4;
  }
  const stats = collectBtShareStats({ share });
  h.printJson({ ok: true, stats });
  return 0;
}

export function parseShareMode(raw: string | undefined): Array<'direct' | 'bt'> {
  return normalizeDownloadModes(raw);
}

export { listFileShares };
