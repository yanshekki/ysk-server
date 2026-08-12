/**
 * Create .torrent files for panel file shares (create-torrent).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BtTrackerSettings } from '@ysk/shared';
import { buildAnnounceList } from './settings.js';

export type CreateShareTorrentResult = {
  ok: boolean;
  infoHash?: string;
  magnetUri?: string;
  torrentRelPath?: string;
  torrentAbsPath?: string;
  name?: string;
  length?: number;
  notes: string[];
};

export async function createShareTorrent(input: {
  dataDir: string;
  /** Absolute path to file or directory to share */
  contentAbsPath: string;
  shareId: string;
  settings: BtTrackerSettings;
  publicHostHint?: string | null;
  name?: string;
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
        },
        (err, torrent) => {
          if (err || !torrent) reject(err || new Error('empty torrent'));
          else resolve(torrent);
        },
      );
    });

    await fsp.writeFile(abs, buf);
    const parseTorrent = (await import('parse-torrent')).default as (
      buf: Buffer,
    ) => {
      infoHash?: string | Buffer;
      name?: string;
      length?: number;
      announce?: string[];
    };
    const parsed = parseTorrent(buf);
    const infoHash = hashToHex(parsed.infoHash);
    if (!infoHash) {
      return { ok: false, notes: ['failed to parse infoHash'], torrentAbsPath: abs };
    }
    const magnetUri = buildMagnet(infoHash, parsed.name || input.name, announce);
    notes.push(`torrent written ${rel}`);
    return {
      ok: true,
      infoHash,
      magnetUri,
      torrentRelPath: rel,
      torrentAbsPath: abs,
      name: parsed.name || input.name,
      length: parsed.length,
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

function buildMagnet(
  infoHash: string,
  name: string | undefined,
  announce: string[],
): string {
  const params = new URLSearchParams();
  params.set('xt', `urn:btih:${infoHash}`);
  if (name) params.set('dn', name);
  for (const a of announce) params.append('tr', a);
  return `magnet:?${params.toString()}`;
}

export function torrentsDir(dataDir: string): string {
  const d = join(dataDir, 'files', 'torrents');
  mkdirSync(d, { recursive: true });
  return d;
}
