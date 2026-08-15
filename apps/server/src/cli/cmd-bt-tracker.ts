/**
 * CLI: bt-tracker — self-hosted BitTorrent tracker for file shares.
 */
import {
  getBtTrackerStatus,
  startBtTrackerService,
  stopBtTrackerService,
  loadBtTrackerSettings,
  patchBtTrackerSettings,
  btTrackerPortBindings,
  listBtTrackerTorrents,
  collectBtShareStats,
  getFileShareById,
  listFileShares,
  normalizeDownloadModes,
  restoreBtSharesOnBoot,
  listTorrentJobs,
  getTorrentJob,
  inspectTorrentInput,
  addBtLibraryItem,
  listBtLibraryLive,
  pauseBtLibraryItem,
  resumeBtLibraryItem,
  removeBtLibraryItemOp,
  isAllowedTrackerUrl,
  syncServiceExposure,
  upsertDesired,
} from 'ysk-server-core';
import { cliPositionals } from '../cli-argv.js';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';

export async function runBtTrackerCommand(
  ctx: AppContext,
  args: string[],
  _json: boolean,
  h: CliHelpers,
): Promise<number> {
  void _json;
  const tokens = cliPositionals(args);
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
      const ports = btTrackerPortBindings(settings);
      try {
        // Settings alone only store desired ports; start/stop own UFW open/close
        upsertDesired(ctx.dataDir, 'bt-tracker', { ports });
      } catch {
        /* non-fatal */
      }
      h.printJson({ ok: true, settings, ports });
      return 0;
    }
    process.stderr.write(
      'Usage: ysk-server bt-tracker settings get|set [--http-port N] [--udp-port N] [--listen-host H] [--public-host H] [--ws|--no-ws] [--autostart|--no-autostart]\n',
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
        ],
      });
      return 3;
    }
    // CLI prefers detached worker so tracker survives this process
    const r = await startBtTrackerService({
      dataDir: ctx.dataDir,
      host: ctx.host,
      preferDetached: true,
    });
    if (r.ok) {
      try {
        const settings = loadBtTrackerSettings(ctx.dataDir);
        await syncServiceExposure({
          host: ctx.host,
          dataDir: ctx.dataDir,
          serviceId: 'bt-tracker',
          ports: btTrackerPortBindings(settings),
          reason: 'start',
          requireDecision: false,
        });
      } catch {
        /* non-fatal */
      }
    }
    h.printJson(r);
    return h.exitFromResult(r);
  }

  if (sub === 'stop') {
    const r = await stopBtTrackerService({ dataDir: ctx.dataDir });
    if (r.ok) {
      try {
        const settings = loadBtTrackerSettings(ctx.dataDir);
        await syncServiceExposure({
          host: ctx.host,
          dataDir: ctx.dataDir,
          serviceId: 'bt-tracker',
          ports: btTrackerPortBindings(settings),
          reason: 'stop',
          requireDecision: false,
        });
      } catch {
        /* non-fatal */
      }
    }
    h.printJson(r);
    return r.ok ? 0 : 1;
  }

  if (sub === 'restore') {
    const r = await restoreBtSharesOnBoot({
      dataDir: ctx.dataDir,
      db: ctx.db,
      host: ctx.host,
    });
    h.printJson(r);
    return r.ok ? 0 : 1;
  }

  if (sub === 'jobs') {
    const id = h.getOpt(args, '--id');
    if (id?.trim()) {
      const job = getTorrentJob(id.trim());
      if (!job) {
        h.printJson({ ok: false, notes: ['job not found'] });
        return 4;
      }
      h.printJson({ ok: true, job });
      return 0;
    }
    const items = listTorrentJobs();
    h.printJson({ ok: true, items, meta: { total: items.length } });
    return 0;
  }

  if (sub === 'inspect') {
    const file = h.getOpt(args, '--file');
    const magnet = h.getOpt(args, '--magnet');
    if (!file && !magnet) {
      process.stderr.write('Usage: ysk-server bt-tracker inspect --file FILE.torrent | --magnet URI\n');
      return 2;
    }
    let torrentBuf: Buffer | undefined;
    if (file) {
      const { readFileSync, existsSync } = await import('node:fs');
      if (!existsSync(file)) {
        h.printJson({ ok: false, notes: ['file not found'] });
        return 4;
      }
      torrentBuf = readFileSync(file);
    }
    const inspected = await inspectTorrentInput({ torrentBuf, magnet });
    h.printJson({ ok: true, ...inspected });
    return 0;
  }

  if (sub === 'add') {
    const file = h.getOpt(args, '--file');
    const magnet = h.getOpt(args, '--magnet');
    const root = h.getOpt(args, '--root') || 'public';
    const dest = h.getOpt(args, '--path');
    if ((!file && !magnet) || !dest) {
      process.stderr.write(
        'Usage: ysk-server bt-tracker add --file FILE.torrent|--magnet URI --root public --path downloads/name\n',
      );
      return 2;
    }
    let torrentBuf: Buffer | undefined;
    if (file) {
      const { readFileSync, existsSync } = await import('node:fs');
      if (!existsSync(file)) {
        h.printJson({ ok: false, notes: ['file not found'] });
        return 4;
      }
      torrentBuf = readFileSync(file);
    }
    const r = await addBtLibraryItem({
      dataDir: ctx.dataDir,
      torrentBuf,
      magnet,
      saveRoot: root,
      saveRelPath: dest,
      start: false,
    });
    h.printJson(r);
    return r.ok ? 0 : 1;
  }

  if (sub === 'library') {
    const id = h.getOpt(args, '--id');
    const items = listBtLibraryLive(ctx.dataDir);
    if (id?.trim()) {
      const item = items.find((i) => i.id === id.trim());
      if (!item) {
        h.printJson({ ok: false, notes: ['library item not found'] });
        return 4;
      }
      h.printJson({ ok: true, item });
      return 0;
    }
    h.printJson({ ok: true, items, meta: { total: items.length } });
    return 0;
  }

  if (sub === 'pause' || sub === 'resume' || sub === 'remove') {
    const id = h.getOpt(args, '--id');
    if (!id?.trim()) {
      process.stderr.write(`Usage: ysk-server bt-tracker ${sub} --id ID\n`);
      return 2;
    }
    if (sub === 'pause') {
      const r = await pauseBtLibraryItem(ctx.dataDir, id.trim());
      h.printJson(r);
      return r.ok ? 0 : 1;
    }
    if (sub === 'resume') {
      const r = await resumeBtLibraryItem(ctx.dataDir, id.trim());
      h.printJson(r);
      return r.ok ? 0 : 1;
    }
    const r = await removeBtLibraryItemOp(ctx.dataDir, id.trim(), {
      deleteFiles: h.hasFlag(args, '--delete-files'),
    });
    h.printJson(r);
    return r.ok ? 0 : 1;
  }

  if (sub === 'trackers') {
    const act = tokens[2] ?? 'list';
    if (act === 'list' || act === 'get') {
      const s = loadBtTrackerSettings(ctx.dataDir);
      h.printJson({ ok: true, items: s.extraTrackers ?? [], meta: { total: (s.extraTrackers ?? []).length } });
      return 0;
    }
    const url = h.getOpt(args, '--url');
    if (act === 'add') {
      if (!url || !isAllowedTrackerUrl(url)) {
        process.stderr.write('Usage: ysk-server bt-tracker trackers add --url http(s)|udp|ws(s)://…\n');
        return 2;
      }
      const s = loadBtTrackerSettings(ctx.dataDir);
      const extra = [...(s.extraTrackers ?? [])];
      if (extra.some((t) => t.url.toLowerCase() === url.trim().toLowerCase())) {
        h.printJson({ ok: true, items: extra, notes: ['already listed'] });
        return 0;
      }
      extra.push({ url: url.trim(), enabled: true });
      const settings = patchBtTrackerSettings(ctx.dataDir, { extraTrackers: extra });
      h.printJson({ ok: true, items: settings.extraTrackers });
      return 0;
    }
    if (act === 'remove' || act === 'enable' || act === 'disable') {
      if (!url) {
        process.stderr.write(`Usage: ysk-server bt-tracker trackers ${act} --url URL\n`);
        return 2;
      }
      const s = loadBtTrackerSettings(ctx.dataDir);
      let extra = [...(s.extraTrackers ?? [])];
      const key = url.trim().toLowerCase();
      if (act === 'remove') extra = extra.filter((t) => t.url.toLowerCase() !== key);
      else {
        extra = extra.map((t) =>
          t.url.toLowerCase() === key ? { ...t, enabled: act === 'enable' } : t,
        );
      }
      const settings = patchBtTrackerSettings(ctx.dataDir, { extraTrackers: extra });
      h.printJson({ ok: true, items: settings.extraTrackers });
      return 0;
    }
    process.stderr.write(
      'Usage: ysk-server bt-tracker trackers [list|add|remove|enable|disable] [--url URL]\n',
    );
    return 2;
  }

  if (sub === 'torrents' || sub === 'stats') {
    const items = listBtTrackerTorrents();
    h.printJson({
      ok: true,
      items,
      meta: { total: items.length },
      note:
        items.length === 0
          ? 'In-process swarm only; detached tracker peers are not listed here'
          : undefined,
    });
    return 0;
  }

  process.stderr.write(
    'Usage: ysk-server bt-tracker status|start|stop|settings|torrents|restore|jobs|inspect|add|library|pause|resume|remove|trackers [--execute] [--json]\n' +
      '  settings set: --http-port --udp-port --listen-host --public-host --ws|--no-ws --autostart|--no-autostart\n' +
      '  add: --file FILE.torrent|--magnet URI --root public --path downloads/name\n' +
      '  trackers add|remove|enable|disable --url URL\n' +
      '  start/stop sync UFW ysk-svc:bt-tracker ports; public host empty ⇒ no magnet trackers\n',
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
