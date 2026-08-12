/**
 * Create .torrent files for panel file shares (create-torrent).
 * Picks piece length from total size for large files/folders.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  promises as fsp,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { BtTrackerSettings } from 'ysk-server-shared';
import { buildAnnounceList } from './settings.js';

export type CreateShareTorrentResult = {
  ok: boolean;
  infoHash?: string;
  magnetUri?: string;
  torrentRelPath?: string;
  torrentAbsPath?: string;
  name?: string;
  length?: number;
  pieceLength?: number;
  notes: string[];
};

/** Prefer fewer pieces for large trees (create-torrent default is often too small). */
export function pickPieceLength(totalBytes: number): number {
  const n = Math.max(0, Number(totalBytes) || 0);
  // Power-of-two piece sizes (bytes)
  if (n >= 8 * 1024 ** 3) return 4 * 1024 * 1024; // ≥8 GiB → 4 MiB
  if (n >= 2 * 1024 ** 3) return 2 * 1024 * 1024; // ≥2 GiB → 2 MiB
  if (n >= 512 * 1024 * 1024) return 1 * 1024 * 1024; // ≥512 MiB → 1 MiB
  if (n >= 64 * 1024 * 1024) return 512 * 1024; // ≥64 MiB → 512 KiB
  if (n >= 8 * 1024 * 1024) return 256 * 1024; // ≥8 MiB → 256 KiB
  return 16 * 1024; // small files → 16 KiB
}

/** Best-effort total size for a file or directory (capped walk). */
export function estimateContentBytes(absPath: string, maxFiles = 50_000): number {
  try {
    const st = statSync(absPath);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
  } catch {
    return 0;
  }
  let total = 0;
  let files = 0;
  const stack = [absPath];
  while (stack.length && files < maxFiles) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === '.' || name === '..') continue;
      const p = join(dir, name);
      try {
        const st = statSync(p);
        if (st.isDirectory()) stack.push(p);
        else if (st.isFile()) {
          total += st.size;
          files += 1;
          if (files >= maxFiles) break;
        }
      } catch {
        /* skip */
      }
    }
  }
  return total;
}

export async function createShareTorrent(input: {
  dataDir: string;
  /** Absolute path to file or directory to share */
  contentAbsPath: string;
  shareId: string;
  settings: BtTrackerSettings;
  publicHostHint?: string | null;
  name?: string;
  /** Override auto piece length */
  pieceLength?: number;
}): Promise<CreateShareTorrentResult> {
  const notes: string[] = [];
  if (!existsSync(input.contentAbsPath)) {
    return { ok: false, notes: ['content path missing'] };
  }
  const announce = buildAnnounceList(input.settings, {
    publicHost: input.publicHostHint || undefined,
  });
  const rel = join('files', 'torrents', `${input.shareId}.torrent`);
  const abs = join(input.dataDir, rel);
  mkdirSync(dirname(abs), { recursive: true });

  const estimated = estimateContentBytes(input.contentAbsPath);
  const pieceLength =
    input.pieceLength && input.pieceLength > 0
      ? input.pieceLength
      : pickPieceLength(estimated);
  if (estimated > 0) {
    notes.push(`content≈${estimated}B pieceLength=${pieceLength}`);
  }

  try {
    const createTorrent = (await import('create-torrent')).default as (
      path: string,
      opts: Record<string, unknown>,
      cb: (err: Error | null, torrent?: Buffer) => void,
    ) => void;

    const buf = await new Promise<Buffer>((resolve, reject) => {
      createTorrent(
        input.contentAbsPath,
        {
          name: input.name,
          announceList: [announce],
          createdBy: 'YSK Server',
          private: false,
          pieceLength,
        },
        (err, torrent) => {
          if (err || !torrent) reject(err || new Error('empty torrent'));
          else resolve(torrent);
        },
      );
    });

    await fsp.writeFile(abs, buf);
    const parseTorrentMod = await import('parse-torrent');
    const parseTorrent = (parseTorrentMod.default ?? parseTorrentMod) as (
      buf: Buffer,
    ) =>
      | {
          infoHash?: string | Buffer;
          name?: string;
          length?: number;
          pieceLength?: number;
          announce?: string[];
        }
      | Promise<{
          infoHash?: string | Buffer;
          name?: string;
          length?: number;
          pieceLength?: number;
          announce?: string[];
        }>;
    // parse-torrent v11 may return a Promise
    const parsed = await Promise.resolve(parseTorrent(buf));
    const infoHash = hashToHex(parsed.infoHash);
    if (!infoHash) {
      return { ok: false, notes: ['failed to parse infoHash'], torrentAbsPath: abs };
    }
    const magnetUri = buildMagnetUri(infoHash, parsed.name || input.name, announce);
    notes.push(`torrent written ${rel}`);
    return {
      ok: true,
      infoHash,
      magnetUri,
      torrentRelPath: rel,
      torrentAbsPath: abs,
      name: parsed.name || input.name,
      length: parsed.length,
      pieceLength: parsed.pieceLength || pieceLength,
      notes,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notes.push(msg.slice(0, 300));
    return { ok: false, notes };
  }
}

function hashToHex(h: unknown): string | undefined {
  if (!h) return undefined;
  if (Buffer.isBuffer(h)) return h.toString('hex');
  const s = String(h);
  if (/^[a-fA-F0-9]{40}$/.test(s)) return s.toLowerCase();
  try {
    return createHash('sha1').update(String(h)).digest('hex');
  } catch {
    return undefined;
  }
}

/**
 * Build a parse-torrent / WebTorrent-compatible magnet URI.
 *
 * Do **not** use URLSearchParams for the whole query: it percent-encodes
 * `xt=urn:btih:…` → `xt=urn%3Abtih%3A…`, which parse-torrent rejects as
 * "Invalid torrent identifier". Keep `xt` literal; encode `dn` / `tr` only.
 */
export function buildMagnetUri(
  infoHash: string,
  name: string | undefined,
  announce: string[],
): string {
  const hash = String(infoHash || '')
    .trim()
    .toLowerCase()
    .replace(/^urn:btih:/i, '');
  if (!/^[a-f0-9]{40}$/.test(hash) && !/^[a-z2-7]{32}$/i.test(hash)) {
    return '';
  }
  const parts = [`xt=urn:btih:${hash}`];
  if (name?.trim()) {
    // encodeURIComponent uses %20 (not +) — required by magnet parsers
    parts.push(`dn=${encodeURIComponent(name.trim())}`);
  }
  for (const a of announce) {
    const tr = String(a || '').trim();
    if (tr) parts.push(`tr=${encodeURIComponent(tr)}`);
  }
  return `magnet:?${parts.join('&')}`;
}

/** Rebuild magnet from infoHash + current tracker announce list (fixes stored bad magnets). */
export function rebuildShareMagnetUri(input: {
  infoHash?: string | null;
  name?: string | null;
  settings: BtTrackerSettings;
  publicHostHint?: string | null;
}): string | undefined {
  const hash = String(input.infoHash || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(hash)) return undefined;
  const announce = buildAnnounceList(input.settings, {
    publicHost: input.publicHostHint || undefined,
  });
  const m = buildMagnetUri(hash, input.name || undefined, announce);
  return m || undefined;
}

export function torrentsDir(dataDir: string): string {
  const d = join(dataDir, 'files', 'torrents');
  mkdirSync(d, { recursive: true });
  return d;
}
