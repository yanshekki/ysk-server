/**
 * BitTorrent tracker service + share BT stats API.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  getBtTrackerStatus,
  startBtTracker,
  stopBtTracker,
  listBtTrackerTorrents,
  listBtTrackerTorrentsAsync,
  loadBtTrackerSettings,
  patchBtTrackerSettings,
  btTrackerPortBindings,
  isBtTrackerRunning,
  createShareTorrent,
  seedShare,
  stopSeed,
  collectBtShareStats,
  getSeedByInfoHash,
  listLocalSeeds,
  listFileShares,
  getFileShareById,
  patchFileShare,
  normalizeDownloadModes,
  createFileShare,
  publicFilesRoot,
  FileManager,
  syncServiceExposure,
  upsertDesired,
  restoreBtSharesOnBoot,
  listTorrentJobs,
  getTorrentJob,
  inspectTorrentInput,
  probeLibraryDest,
  addBtLibraryItem,
  listBtLibraryLive,
  pauseBtLibraryItem,
  resumeBtLibraryItem,
  removeBtLibraryItemOp,
  applyExtraTrackersNow,
} from 'ysk-server-core';
import { ErrorCodes, YskError } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

const BASE = '/api/v1/system/bt-tracker';

export async function handleBtTrackerRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith(BASE) && !url.pathname.startsWith('/api/v1/files/shares')) {
    return false;
  }

  // —— Tracker service ——
  if (url.pathname.startsWith(BASE)) {
    try {
      if (method === 'GET' && url.pathname === `${BASE}/status`) {
        ctx.auth.authenticate(getBearer(req));
        const st = await getBtTrackerStatus({
          dataDir: ctx.dataDir,
          host: ctx.host,
        });
        sendJson(res, 200, { ok: true, ...st });
        return true;
      }
      if (method === 'GET' && url.pathname === `${BASE}/settings`) {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, {
          ok: true,
          settings: loadBtTrackerSettings(ctx.dataDir),
        });
        return true;
      }
      if (method === 'PATCH' && url.pathname === `${BASE}/settings`) {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as Record<string, unknown>;
        const settings = patchBtTrackerSettings(ctx.dataDir, data as never);
        const ports = btTrackerPortBindings(settings);
        const wasRunning = isBtTrackerRunning();
        // Persist desired ports only. Live listen + UFW open/close are owned by
        // start (bind + open) and stop (close sockets + remove UFW rules).
        // Changing ports while running needs a restart to re-bind.
        try {
          upsertDesired(ctx.dataDir, 'bt-tracker', { ports });
        } catch {
          /* non-fatal */
        }
        ctx.audit.append({
          actor: user.username,
          action: 'bt_tracker.settings',
          detail: {
            keys: Object.keys(data),
            httpPort: settings.httpPort,
            udpPort: settings.udpPort,
            running: wasRunning,
          },
          ok: true,
        });
        sendJson(res, 200, {
          ok: true,
          settings,
          ports,
          restartRequired: wasRunning,
          notes: wasRunning
            ? [
                'Ports saved. Restart the tracker so HTTP/UDP listen sockets pick up the new ports.',
              ]
            : undefined,
        });
        return true;
      }
      if (method === 'POST' && url.pathname === `${BASE}/start`) {
        const user = ctx.auth.authenticate(getBearer(req));
        const r = await startBtTracker({ dataDir: ctx.dataDir, host: ctx.host });
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
        ctx.audit.append({
          actor: user.username,
          action: 'bt_tracker.start',
          detail: { ok: r.ok },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === `${BASE}/stop`) {
        const user = ctx.auth.authenticate(getBearer(req));
        const r = await stopBtTracker();
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
            /* non-fatal — process sockets already closed */
          }
        }
        ctx.audit.append({
          actor: user.username,
          action: 'bt_tracker.stop',
          detail: { ok: r.ok },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname === `${BASE}/jobs`) {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, { ok: true, items: listTorrentJobs() });
        return true;
      }
      if (method === 'GET' && url.pathname.startsWith(`${BASE}/jobs/`)) {
        ctx.auth.authenticate(getBearer(req));
        const id = decodeURIComponent(url.pathname.slice(`${BASE}/jobs/`.length));
        const job = getTorrentJob(id);
        if (!job) {
          sendJson(res, 404, { ok: false, code: ErrorCodes.NOT_FOUND });
          return true;
        }
        sendJson(res, 200, { ok: true, job });
        return true;
      }
      if (method === 'POST' && url.pathname === `${BASE}/restore`) {
        const user = ctx.auth.authenticate(getBearer(req));
        const r = await restoreBtSharesOnBoot({
          dataDir: ctx.dataDir,
          db: ctx.db,
          host: ctx.host,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'bt_tracker.restore',
          detail: {
            ok: r.ok,
            seeded: r.seeded,
            attempted: r.attempted,
            failed: r.failed,
          },
          ok: r.ok,
        });
        sendJson(res, 200, r);
        return true;
      }
      if (method === 'POST' && url.pathname === `${BASE}/library/inspect`) {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req, { maxBytes: 12 * 1024 * 1024 });
        const data = JSON.parse(raw || '{}') as {
          torrentBase64?: string;
          magnet?: string;
        };
        let torrentBuf: Buffer | undefined;
        if (data.torrentBase64) {
          torrentBuf = Buffer.from(String(data.torrentBase64), 'base64');
        }
        const inspected = await inspectTorrentInput({
          torrentBuf,
          magnet: data.magnet,
        });
        sendJson(res, 200, { ok: true, ...inspected });
        return true;
      }
      if (method === 'POST' && url.pathname === `${BASE}/library/probe`) {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req, { maxBytes: 64 * 1024 });
        const data = JSON.parse(raw || '{}') as {
          saveRoot?: string;
          parentRel?: string;
          name?: string;
          files?: Array<{ path?: string; length?: number }>;
        };
        const probe = probeLibraryDest({
          dataDir: ctx.dataDir,
          saveRoot: String(data.saveRoot || 'public'),
          parentRel: String(data.parentRel || ''),
          name: String(data.name || ''),
          files: (data.files ?? []).map((f) => ({
            path: String(f.path || ''),
            length: Number(f.length) || 0,
          })),
        });
        sendJson(res, 200, { ok: true, ...probe });
        return true;
      }
      if (method === 'POST' && url.pathname === `${BASE}/library/apply-trackers`) {
        const user = ctx.auth.authenticate(getBearer(req));
        const r = applyExtraTrackersNow(ctx.dataDir);
        ctx.audit.append({
          actor: user.username,
          action: 'bt_tracker.apply_trackers',
          detail: { applied: r.applied },
          ok: r.ok,
        });
        sendJson(res, 200, r);
        return true;
      }
      if (method === 'POST' && url.pathname === `${BASE}/library`) {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req, { maxBytes: 12 * 1024 * 1024 });
        const data = JSON.parse(raw || '{}') as {
          torrentBase64?: string;
          magnet?: string;
          saveRoot?: string;
          saveRelPath?: string;
          parentRel?: string;
          mode?: 'download' | 'seed-existing';
        };
        let torrentBuf: Buffer | undefined;
        if (data.torrentBase64) {
          torrentBuf = Buffer.from(String(data.torrentBase64), 'base64');
        }
        const r = await addBtLibraryItem({
          dataDir: ctx.dataDir,
          torrentBuf,
          magnet: data.magnet,
          saveRoot: String(data.saveRoot || 'public'),
          saveRelPath: String(data.saveRelPath || ''),
          parentRel: data.parentRel,
          mode: data.mode === 'seed-existing' ? 'seed-existing' : 'download',
        });
        ctx.audit.append({
          actor: user.username,
          action: 'bt_tracker.library_add',
          detail: { ok: r.ok, id: r.item?.id, hash: r.item?.infoHash },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname === `${BASE}/library`) {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, { ok: true, items: listBtLibraryLive(ctx.dataDir) });
        return true;
      }
      const libOne = url.pathname.match(
        new RegExp(`^${BASE.replace(/\//g, '\\/')}/library/([^/]+)(?:/(pause|resume))?$`),
      );
      if (libOne) {
        ctx.auth.authenticate(getBearer(req));
        const id = decodeURIComponent(libOne[1] ?? '');
        const act = libOne[2];
        if (method === 'GET' && !act) {
          const item = listBtLibraryLive(ctx.dataDir).find((i) => i.id === id);
          if (!item) {
            sendJson(res, 404, { ok: false, code: ErrorCodes.NOT_FOUND });
            return true;
          }
          sendJson(res, 200, { ok: true, item });
          return true;
        }
        if (method === 'POST' && act === 'pause') {
          const r = await pauseBtLibraryItem(ctx.dataDir, id);
          sendJson(res, 200, r);
          return true;
        }
        if (method === 'POST' && act === 'resume') {
          const r = await resumeBtLibraryItem(ctx.dataDir, id);
          sendJson(res, 200, r);
          return true;
        }
        if (method === 'DELETE' && !act) {
          const deleteFiles = url.searchParams.get('deleteFiles') === '1';
          const r = await removeBtLibraryItemOp(ctx.dataDir, id, { deleteFiles });
          sendJson(res, 200, r);
          return true;
        }
      }
      if (method === 'GET' && url.pathname === `${BASE}/torrents`) {
        ctx.auth.authenticate(getBearer(req));
        const shares = listFileShares(ctx.db);
        const hints = shares
          .filter((s) => s.infoHash)
          .map((s) => {
            const seed = getSeedByInfoHash(s.infoHash!);
            return {
              infoHash: s.infoHash,
              name: s.path.split('/').pop(),
              shareId: s.id,
              seedStatus: s.seedStatus,
              seeders: seed ? 1 : 0,
              leechers: 0,
            };
          });
        // also surface in-memory seeds without share row
        for (const seed of listLocalSeeds()) {
          if (!hints.some((h) => h.infoHash?.toLowerCase() === seed.infoHash)) {
            hints.push({
              infoHash: seed.infoHash,
              name: seed.torrent.name,
              shareId: seed.shareId,
              seedStatus: 'seeding',
              seeders: 1,
              leechers: 0,
            });
          }
        }
        const rows = await listBtTrackerTorrentsAsync({
          hints,
          dataDir: ctx.dataDir,
          forceScrape: false,
        });
        const byHash = new Map(
          shares
            .filter((s) => s.infoHash)
            .map((s) => [s.infoHash!.toLowerCase(), s]),
        );
        const lib = listBtLibraryLive(ctx.dataDir);
        const libByHash = new Map(lib.map((i) => [i.infoHash.toLowerCase(), i]));
        const items = rows.map((r) => {
          const sh = byHash.get(r.infoHash.toLowerCase());
          const seed = getSeedByInfoHash(r.infoHash);
          const li = libByHash.get(r.infoHash.toLowerCase());
          return {
            ...r,
            name: r.name || li?.name || sh?.path.split('/').pop() || seed?.torrent.name,
            shareId: r.shareId || sh?.id || seed?.shareId,
            seedStatus:
              r.seedStatus ||
              li?.status ||
              sh?.seedStatus ||
              (seed ? 'seeding' : undefined),
            uploadSpeed: seed
              ? Number(seed.torrent.uploadSpeed) || 0
              : undefined,
            downloadSpeed: seed
              ? Number(seed.torrent.downloadSpeed) || 0
              : undefined,
            kind: li ? 'library' : sh ? 'share' : 'swarm',
            libraryId: li?.id,
            progress: li?.progress ?? seed?.torrent.progress,
            sizeBytes: li?.sizeBytes,
            downloaded: li?.downloaded,
            saveRoot: li?.saveRoot,
            saveRelPath: li?.saveRelPath,
          };
        });
        for (const li of lib) {
          if (!items.some((x) => x.infoHash.toLowerCase() === li.infoHash)) {
            items.push({
              infoHash: li.infoHash,
              name: li.name,
              seeders: 0,
              leechers: 0,
              shareId: undefined,
              seedStatus: li.status,
              kind: 'library',
              libraryId: li.id,
              progress: li.progress,
              sizeBytes: li.sizeBytes,
              downloaded: li.downloaded,
              saveRoot: li.saveRoot,
              saveRelPath: li.saveRelPath,
              uploadSpeed: li.uploadSpeed,
              downloadSpeed: li.downloadSpeed,
            });
          }
        }
        sendJson(res, 200, { ok: true, items });
        return true;
      }
      return false;
    } catch (e) {
      if (e instanceof YskError) {
        sendJson(res, e.httpStatus || 400, {
          ok: false,
          code: e.code,
          message: e.message,
          details: e.details,
        });
        return true;
      }
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 500, { ok: false, code: ErrorCodes.INTERNAL, message: msg });
      return true;
    }
  }

  // —— Share BT stats (authenticated) ——
  if (method === 'POST' && url.pathname === '/api/v1/files/shares/bt-stats') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ids?: string[] };
    const ids = Array.isArray(data.ids) ? data.ids.slice(0, 50) : [];
    const tracker = listBtTrackerTorrents();
    const tMap = new Map(tracker.map((t) => [t.infoHash.toLowerCase(), t]));
    const items: Record<string, unknown> = {};
    for (const id of ids) {
      const share = getFileShareById(ctx.db, id);
      if (!share) continue;
      const tr = share.infoHash ? tMap.get(share.infoHash.toLowerCase()) : undefined;
      items[share.id] = collectBtShareStats({
        share,
        trackerSeeders: tr?.seeders,
        trackerLeechers: tr?.leechers,
      });
    }
    sendJson(res, 200, { ok: true, items });
    return true;
  }

  const statsMatch = url.pathname.match(
    /^\/api\/v1\/files\/shares\/([^/]+)\/bt-stats$/,
  );
  if (method === 'GET' && statsMatch) {
    ctx.auth.authenticate(getBearer(req));
    const id = decodeURIComponent(statsMatch[1] ?? '');
    const share = getFileShareById(ctx.db, id);
    if (!share) {
      sendJson(res, 404, { ok: false, code: ErrorCodes.NOT_FOUND });
      return true;
    }
    const tr = share.infoHash
      ? listBtTrackerTorrents().find(
          (t) => t.infoHash.toLowerCase() === share.infoHash!.toLowerCase(),
        )
      : undefined;
    sendJson(res, 200, {
      ok: true,
      stats: collectBtShareStats({
        share,
        trackerSeeders: tr?.seeders,
        trackerLeechers: tr?.leechers,
      }),
    });
    return true;
  }

  return false;
}

/** Resolve absolute content path for a share root+path */
export function resolveShareContentPath(
  ctx: AppContext,
  rootKey: string,
  relPath: string,
): string {
  let root: string;
  if (rootKey === 'public' || !rootKey) {
    root = publicFilesRoot(ctx.dataDir);
  } else if (rootKey.startsWith('project:')) {
    const projectId = rootKey.slice('project:'.length);
    const proj = ctx.projects.get(projectId);
    root = proj.homeDir;
  } else {
    root = publicFilesRoot(ctx.dataDir);
  }
  const fm = new FileManager(root);
  // FileManager resolves relative safely
  const st = fm.stat(relPath);
  return join(root, st.path || relPath);
}

export { createShareTorrent, seedShare, stopSeed, patchFileShare, createFileShare, normalizeDownloadModes };
