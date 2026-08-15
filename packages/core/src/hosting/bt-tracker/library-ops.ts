/**
 * Inspect / add / pause / remove WebTorrent library items.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ErrorCodes,
  YskError,
  tl,
  type BtLibraryDestMode,
  type BtLibraryDestProbe,
  type BtLibraryFile,
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
  if (s.includes('\0')) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryDestBad'), {
      httpStatus: 400,
    });
  }
  if (!s || s === '.') return '.';
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
  opts?: { mkdir?: boolean },
): { rootAbs: string; destAbs: string; saveRelPath: string } {
  const rel = sanitizeSaveRelPath(saveRelPath);
  const rootAbs = resolveLibraryRootAbs(dataDir, saveRoot);
  const destAbs = rel === '.' ? rootAbs : join(rootAbs, rel);
  if (opts?.mkdir === false || rel === '.') {
    return { rootAbs, destAbs, saveRelPath: rel };
  }
  if (existsSync(destAbs) && statSync(destAbs).isFile()) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.libraryDestIsFile', { name: rel }), {
      httpStatus: 409,
      details: { reason: 'EEXIST', path: rel, type: 'file' },
    });
  }
  const fm = new FileManager(rootAbs);
  if (rel !== '.') fm.mkdir(rel, { ifExists: 'merge' });
  return { rootAbs, destAbs, saveRelPath: rel };
}

function countMatchingFiles(dirAbs: string, files: BtLibraryFile[]): number {
  let n = 0;
  for (const f of files) {
    const rel = String(f.path || '').replace(/^\/+/, '');
    if (!rel || rel.includes('..')) continue;
    const abs = join(dirAbs, rel);
    try {
      if (!existsSync(abs) || !statSync(abs).isFile()) continue;
      if (f.length > 0 && statSync(abs).size !== f.length) continue;
      n += 1;
    } catch {
      /* */
    }
  }
  return n;
}

/** Where to download vs seed-existing, given the folder the operator is browsing. */
export function probeLibraryDest(input: {
  dataDir: string;
  saveRoot: string;
  parentRel?: string;
  name: string;
  files: BtLibraryFile[];
}): BtLibraryDestProbe {
  const destName = sanitizeTorrentFolderName(input.name);
  const parent = String(input.parentRel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const destRel = [parent, destName].filter(Boolean).join('/') || destName;
  const rootAbs = resolveLibraryRootAbs(input.dataDir, input.saveRoot);
  const destAbs = join(rootAbs, destRel);
  const parentAbs = parent ? join(rootAbs, parent) : rootAbs;
  const files = (input.files ?? []).filter((f) => f.path);
  const totalFiles = files.length || 1;

  let destKind: BtLibraryDestProbe['destKind'] = 'missing';
  let conflictName: string | undefined;
  if (existsSync(destAbs)) {
    if (statSync(destAbs).isFile()) {
      destKind = 'file-conflict';
      conflictName = destName;
    } else {
      destKind = 'dir';
    }
  }

  const matchInDest = destKind === 'dir' ? countMatchingFiles(destAbs, files) : 0;
  const matchInParent =
    existsSync(parentAbs) && statSync(parentAbs).isDirectory()
      ? countMatchingFiles(parentAbs, files)
      : 0;
  let matchAtFile = 0;
  if (destKind === 'file-conflict' && files.length === 1) {
    const leaf = String(files[0]?.path || '').split('/').pop();
    if (leaf === destName) {
      try {
        const st = statSync(destAbs);
        if (st.isFile() && (!files[0]!.length || st.size === files[0]!.length)) matchAtFile = 1;
      } catch {
        /* */
      }
    }
  }

  const matchCount = Math.max(matchInDest, matchInParent, matchAtFile);
  const canSeedExisting = totalFiles > 0 && matchCount >= totalFiles;
  let seedRel: string | null = null;
  if (canSeedExisting) {
    if (matchInDest >= totalFiles && destKind === 'dir') seedRel = destRel;
    else seedRel = parent || '.';
  }

  return {
    destRel,
    seedRel,
    destKind,
    matchCount,
    totalFiles,
    canSeedExisting,
    conflictName,
  };
}

export function destLooksPopulated(destAbs: string): boolean {
  try {
    if (!existsSync(destAbs)) return false;
    const st = statSync(destAbs);
    if (st.isFile()) return st.size > 0;
    return readdirSync(destAbs).length > 0;
  } catch {
    return false;
  }
}

export function deriveLibraryLiveStatus(input: {
  stored: BtLibraryStatus;
  hasSeed: boolean;
  progress?: number;
  done?: boolean;
  paused?: boolean;
  destHasFiles?: boolean;
}): BtLibraryStatus {
  if (input.stored === 'paused' || input.stored === 'queued') return input.stored;
  if (!input.hasSeed) return input.stored;
  if (input.paused) return 'paused';
  const progress = Number(input.progress) || 0;
  if (input.done || progress >= 1) return 'seeding';
  if (progress > 0) return 'downloading';
  if (input.destHasFiles) return 'checking';
  return 'downloading';
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
  /** Folder the operator is browsing (for seed-existing probe). */
  parentRel?: string;
  mode?: BtLibraryDestMode;
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
  const mode: BtLibraryDestMode = input.mode === 'seed-existing' ? 'seed-existing' : 'download';
  let saveRel = input.saveRelPath;
  if (mode === 'seed-existing') {
    const probe = probeLibraryDest({
      dataDir: input.dataDir,
      saveRoot: input.saveRoot,
      parentRel: input.parentRel ?? '',
      name: inspected.name,
      files: inspected.files,
    });
    if (!probe.canSeedExisting || !probe.seedRel) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.btTracker.librarySeedMissing'), {
        httpStatus: 400,
      });
    }
    saveRel = probe.seedRel;
  }
  const dest = resolveLibraryDestAbs(input.dataDir, input.saveRoot, saveRel, {
    mkdir: mode !== 'seed-existing',
  });
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
    let destAbs = '';
    try {
      destAbs = resolveLibraryDestAbs(dataDir, item.saveRoot, item.saveRelPath, {
        mkdir: false,
      }).destAbs;
    } catch {
      destAbs = '';
    }
    const destHasFiles = destAbs ? destLooksPopulated(destAbs) : false;
    const status = deriveLibraryLiveStatus({
      stored: item.status,
      hasSeed: Boolean(seed),
      progress: t?.progress,
      done: t?.done,
      paused: t?.paused,
      destHasFiles,
    });
    const ageMs = Date.now() - Date.parse(item.createdAt || '') || 0;
    const waitHint =
      status === 'downloading' &&
      !destHasFiles &&
      (Number(t?.progress) || 0) <= 0 &&
      ageMs > 15_000
        ? tl('notes.btTracker.libraryWaitingPeers')
        : undefined;
    return {
      ...item,
      status,
      progress: t?.progress,
      downloadSpeed: t?.downloadSpeed,
      uploadSpeed: t?.uploadSpeed,
      peers: t?.numPeers,
      downloaded: t?.downloaded,
      sizeBytes: item.sizeBytes ?? t?.length,
      hint: waitHint,
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
