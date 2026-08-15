/**
 * Inspect / add / pause / remove WebTorrent library items.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ErrorCodes,
  YskError,
  tl,
  type BtLibraryInspect,
  type BtLibraryItem,
  type BtLibraryStatus,
} from 'ysk-server-shared';
import { FileManager, publicFilesRoot } from '../../files/manager.js';
import { projectHomeDir } from '../project.js';
import {
  loadBtTrackerSettings,
  buildLibraryAnnounceList,
  enabledExtraTrackerUrls,
} from './settings.js';
import {
  getBtLibraryByHash,
  getBtLibraryItem,
  loadBtLibrary,
  patchBtLibraryItem,
  removeBtLibraryItem,
  torrentStoreDir,
  upsertBtLibraryItem,
} from './library.js';
import {
  addLibrarySeed,
  applyExtraTrackersToSeeds,
  getSeedByShareId,
  listLocalSeeds,
  pauseSeed,
  resumeSeed,
  stopSeed,
} from './seeder.js';

export const MAX_TORRENT_BYTES = 8 * 1024 * 1024;

export function sanitizeTorrentFolderName(name: string): string {
  const s = String(name || '')
    .replace(/[\\/:*?"<>|\0]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return s || 'download';
}

export function sanitizeSaveRelPath(raw: string): string {
  const s = String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  if (!s || s.includes('\0')) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryDestBad'), {
      httpStatus: 400,
    });
  }
  const parts = s.split('/').filter((p) => p && p !== '.' && p !== '..');
  if (!parts.length) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryDestBad'), {
      httpStatus: 400,
    });
  }
  return parts.join('/');
}

export function resolveLibraryRootAbs(dataDir: string, saveRoot: string): string {
  const root = String(saveRoot || 'public').trim() || 'public';
  if (root === 'public') return publicFilesRoot(dataDir);
  if (root.startsWith('project:')) {
    const id = root.slice('project:'.length).trim();
    if (!id) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryDestBad'), {
        httpStatus: 400,
      });
    }
    return projectHomeDir(id);
  }
  throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryDestBad'), {
    httpStatus: 400,
  });
}

export function resolveLibraryDestAbs(
  dataDir: string,
  saveRoot: string,
  saveRelPath: string,
): { rootAbs: string; destAbs: string; saveRelPath: string } {
  const rel = sanitizeSaveRelPath(saveRelPath);
  const rootAbs = resolveLibraryRootAbs(dataDir, saveRoot);
  const fm = new FileManager(rootAbs);
  fm.mkdir(rel, { ifExists: 'merge' });
  return { rootAbs, destAbs: join(rootAbs, rel), saveRelPath: rel };
}

function hashToHex(h: unknown): string {
  if (!h) return '';
  if (Buffer.isBuffer(h)) return h.toString('hex').toLowerCase();
  const s = String(h).trim().toLowerCase().replace(/^urn:btih:/i, '');
  return /^[a-f0-9]{40}$/.test(s) || /^[a-z2-7]{32}$/i.test(s) ? s : '';
}

export async function inspectTorrentInput(input: {
  torrentBuf?: Buffer;
  magnet?: string;
}): Promise<BtLibraryInspect> {
  const magnet = String(input.magnet || '').trim();
  if (input.torrentBuf && input.torrentBuf.length > MAX_TORRENT_BYTES) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryTorrentTooBig'), {
      httpStatus: 400,
    });
  }
  if ((!input.torrentBuf || !input.torrentBuf.length) && !magnet) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryInspectFailed'), {
      httpStatus: 400,
    });
  }
  if (magnet && !magnet.toLowerCase().startsWith('magnet:')) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryInspectFailed'), {
      httpStatus: 400,
    });
  }
  try {
    const parseTorrentMod = await import('parse-torrent');
    const parseTorrent = (parseTorrentMod.default ?? parseTorrentMod) as (
      x: Buffer | string,
    ) =>
      | {
          infoHash?: string | Buffer;
          name?: string;
          length?: number;
          private?: boolean;
          announce?: string[];
          files?: Array<{ path?: string; name?: string; length?: number }>;
        }
      | Promise<{
          infoHash?: string | Buffer;
          name?: string;
          length?: number;
          private?: boolean;
          announce?: string[];
          files?: Array<{ path?: string; name?: string; length?: number }>;
        }>;
    const parsed = await Promise.resolve(
      parseTorrent(input.torrentBuf && input.torrentBuf.length ? input.torrentBuf : magnet),
    );
    const infoHash = hashToHex(parsed.infoHash);
    if (!infoHash) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryInspectFailed'), {
        httpStatus: 400,
      });
    }
    const files = (parsed.files ?? []).map((f) => ({
      path: String(f.path || f.name || '').replace(/\\/g, '/'),
      length: Number(f.length) || 0,
    }));
    const sizeBytes =
      Number(parsed.length) || files.reduce((a, f) => a + (f.length || 0), 0);
    const name = String(parsed.name || files[0]?.path || infoHash).trim() || infoHash;
    return {
      infoHash,
      name,
      sizeBytes,
      private: Boolean(parsed.private),
      announce: Array.isArray(parsed.announce)
        ? parsed.announce.map((u) => String(u)).filter(Boolean)
        : [],
      files,
      magnetUri: magnet || undefined,
    };
  } catch (e) {
    if (e instanceof YskError) throw e;
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryInspectFailed'), {
      httpStatus: 400,
      cause: e,
    });
  }
}

export async function addBtLibraryItem(input: {
  dataDir: string;
  torrentBuf?: Buffer;
  magnet?: string;
  saveRoot: string;
  saveRelPath: string;
  /** When false, persist only (CLI outside serve). Default true. */
  start?: boolean;
}): Promise<{
  ok: boolean;
  item?: BtLibraryItem;
  notes: string[];
  blocked?: boolean;
}> {
  const notes: string[] = [];
  const inspected = await inspectTorrentInput({
    torrentBuf: input.torrentBuf,
    magnet: input.magnet,
  });
  const existing = getBtLibraryByHash(input.dataDir, inspected.infoHash);
  if (existing) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryDup'), {
      httpStatus: 409,
      details: { id: existing.id, infoHash: existing.infoHash },
    });
  }
  const dest = resolveLibraryDestAbs(input.dataDir, input.saveRoot, input.saveRelPath);
  const settings = loadBtTrackerSettings(input.dataDir);
  const live = listLocalSeeds().length;
  const id = randomUUID();
  let torrentRelPath: string | undefined;
  if (input.torrentBuf && input.torrentBuf.length) {
    const dir = torrentStoreDir(input.dataDir);
    mkdirSync(dir, { recursive: true });
    const abs = join(dir, `${id}.torrent`);
    writeFileSync(abs, input.torrentBuf);
    torrentRelPath = join('bt', 'torrents', `${id}.torrent`);
  }
  const now = new Date().toISOString();
  const queued = live >= settings.maxSeeds;
  const item: BtLibraryItem = {
    id,
    infoHash: inspected.infoHash,
    name: inspected.name,
    torrentRelPath,
    saveRoot: String(input.saveRoot || 'public').trim() || 'public',
    saveRelPath: dest.saveRelPath,
    source: 'library',
    status: queued ? 'queued' : 'checking',
    magnetUri: input.magnet?.trim() || inspected.magnetUri,
    sizeBytes: inspected.sizeBytes,
    createdAt: now,
    updatedAt: now,
  };
  upsertBtLibraryItem(input.dataDir, item);
  if (input.start === false) {
    notes.push(tl('notes.btTracker.libraryNeedServe'));
    const queuedItem = patchBtLibraryItem(input.dataDir, id, { status: 'queued' }) ?? item;
    return { ok: true, item: queuedItem, notes };
  }
  if (queued) {
    notes.push(tl('notes.btTracker.maxSeeds', { n: String(settings.maxSeeds) }));
    return { ok: true, item, notes };
  }
  const torrentAbs = torrentRelPath ? join(input.dataDir, torrentRelPath) : undefined;
  const started = await addLibrarySeed({
    dataDir: input.dataDir,
    id,
    destAbs: dest.destAbs,
    torrentAbsPath: torrentAbs,
    magnetUri: item.magnetUri,
    torrentAnnounce: inspected.announce,
  });
  notes.push(...started.notes);
  const next = patchBtLibraryItem(input.dataDir, id, {
    status: started.status,
    errorNote: started.ok ? undefined : started.notes.join('; ').slice(0, 400),
  });
  return { ok: started.ok, item: next ?? item, notes };
}

export async function pauseBtLibraryItem(
  dataDir: string,
  id: string,
): Promise<{ ok: boolean; item?: BtLibraryItem; notes: string[] }> {
  const item = getBtLibraryItem(dataDir, id);
  if (!item) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.btTracker.libraryNotFound'), {
      httpStatus: 404,
    });
  }
  const r = await pauseSeed(id);
  const next = patchBtLibraryItem(dataDir, id, { status: 'paused' });
  return { ok: true, item: next, notes: r.notes };
}

export async function resumeBtLibraryItem(
  dataDir: string,
  id: string,
): Promise<{ ok: boolean; item?: BtLibraryItem; notes: string[] }> {
  const item = getBtLibraryItem(dataDir, id);
  if (!item) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.btTracker.libraryNotFound'), {
      httpStatus: 404,
    });
  }
  const live = getSeedByShareId(id);
  if (live) {
    const r = await resumeSeed(id);
    const next = patchBtLibraryItem(dataDir, id, { status: 'downloading' });
    return { ok: r.ok, item: next, notes: r.notes };
  }
  const dest = resolveLibraryDestAbs(dataDir, item.saveRoot, item.saveRelPath);
  const torrentAbs = item.torrentRelPath
    ? join(dataDir, item.torrentRelPath)
    : undefined;
  const started = await addLibrarySeed({
    dataDir,
    id,
    destAbs: dest.destAbs,
    torrentAbsPath: torrentAbs && existsSync(torrentAbs) ? torrentAbs : undefined,
    magnetUri: item.magnetUri,
    torrentAnnounce: [],
  });
  const next = patchBtLibraryItem(dataDir, id, {
    status: started.status,
    errorNote: started.ok ? undefined : started.notes.join('; ').slice(0, 400),
  });
  return { ok: started.ok, item: next, notes: started.notes };
}

export async function removeBtLibraryItemOp(
  dataDir: string,
  id: string,
  opts?: { deleteFiles?: boolean },
): Promise<{ ok: boolean; notes: string[] }> {
  const item = getBtLibraryItem(dataDir, id);
  if (!item) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.btTracker.libraryNotFound'), {
      httpStatus: 404,
    });
  }
  const notes: string[] = [];
  const stop = await stopSeed(id);
  notes.push(...stop.notes);
  if (opts?.deleteFiles) {
    try {
      const dest = resolveLibraryDestAbs(dataDir, item.saveRoot, item.saveRelPath);
      if (existsSync(dest.destAbs) && dest.destAbs !== dest.rootAbs) {
        rmSync(dest.destAbs, { recursive: true, force: true });
        notes.push(tl('notes.btTracker.libraryFilesRemoved'));
      }
    } catch (e) {
      notes.push(e instanceof Error ? e.message.slice(0, 200) : String(e));
    }
  }
  if (item.torrentRelPath) {
    const abs = join(dataDir, item.torrentRelPath);
    try {
      if (existsSync(abs)) rmSync(abs, { force: true });
    } catch {
      /* */
    }
  }
  removeBtLibraryItem(dataDir, id);
  notes.push(tl('notes.btTracker.libraryRemoved'));
  return { ok: true, notes };
}

export function listBtLibraryLive(dataDir: string): Array<
  BtLibraryItem & {
    progress?: number;
    downloadSpeed?: number;
    uploadSpeed?: number;
    peers?: number;
    downloaded?: number;
  }
> {
  const items = loadBtLibrary(dataDir);
  return items.map((item) => {
    const seed = getSeedByShareId(item.id);
    const t = seed?.torrent;
    let status: BtLibraryStatus = item.status;
    if (item.status !== 'paused' && item.status !== 'queued' && seed) {
      if (t?.paused) status = 'paused';
      else if ((t?.progress ?? 0) >= 1 || t?.done) status = 'seeding';
      else if ((t?.progress ?? 0) > 0) status = 'downloading';
      else status = 'checking';
    }
    return {
      ...item,
      status,
      progress: t?.progress,
      downloadSpeed: t?.downloadSpeed,
      uploadSpeed: t?.uploadSpeed,
      peers: t?.numPeers,
      downloaded: t?.downloaded,
      sizeBytes: item.sizeBytes ?? t?.length,
    };
  });
}

export function applyExtraTrackersNow(dataDir: string): {
  ok: boolean;
  applied: number;
  notes: string[];
} {
  const urls = enabledExtraTrackerUrls(loadBtTrackerSettings(dataDir));
  const r = applyExtraTrackersToSeeds(urls);
  return {
    ok: true,
    applied: r.applied,
    notes: [tl('notes.btTracker.applyTrackersDone', { n: String(r.applied) })],
  };
}

export function extraAnnouncePreview(dataDir: string, torrentAnnounce: string[] = []): string[] {
  return buildLibraryAnnounceList(loadBtTrackerSettings(dataDir), torrentAnnounce);
}

export { loadBtLibrary, getBtLibraryItem };
