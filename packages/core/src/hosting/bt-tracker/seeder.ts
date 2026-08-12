/**
 * In-process WebTorrent seeder for panel file shares.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BtShareStats } from '@ysk/shared';
import { tl } from '@ysk/shared';
import type { FileShareRecord } from '../../files/manager.js';
import { loadBtTrackerSettings } from './settings.js';

type SeedEntry = {
  shareId: string;
  infoHash: string;
  torrent: {
    infoHash?: string;
    name?: string;
    length?: number;
    numPeers?: number;
    downloadSpeed?: number;
    uploadSpeed?: number;
    downloaded?: number;
    uploaded?: number;
    progress?: number;
    destroy?: (opts?: { destroyStore?: boolean }, cb?: () => void) => void;
    on?: (ev: string, fn: (...a: unknown[]) => void) => void;
  };
};

type WtClient = {
  add: (
    torrentId: string | Buffer,
    opts: Record<string, unknown>,
    cb?: (torrent: SeedEntry['torrent']) => void,
  ) => SeedEntry['torrent'];
  destroy: (cb?: (err?: Error) => void) => void;
};

let client: WtClient | null = null;
const seeds = new Map<string, SeedEntry>();

export function listLocalSeeds(): SeedEntry[] {
  return [...seeds.values()];
}

export function getSeedByShareId(shareId: string): SeedEntry | undefined {
  return seeds.get(shareId);
}

export function getSeedByInfoHash(infoHash: string): SeedEntry | undefined {
  const h = infoHash.toLowerCase();
  for (const s of seeds.values()) {
    if (s.infoHash === h) return s;
  }
  return undefined;
}

async function ensureClient(): Promise<WtClient> {
  if (client) return client;
  const WebTorrent = (await import('webtorrent')).default as new (
    opts?: Record<string, unknown>,
  ) => WtClient;
  client = new WebTorrent({ utp: true });
  return client;
}

function contentBasePath(abs: string): string {
  try {
    if (statSync(abs).isDirectory()) return abs;
  } catch {
    /* */
  }
  return dirname(abs);
}

export async function seedShare(input: {
  dataDir: string;
  share: FileShareRecord;
  contentAbsPath: string;
  torrentAbsPath: string;
}): Promise<{ ok: boolean; notes: string[]; seedStatus: FileShareRecord['seedStatus'] }> {
  const notes: string[] = [];
  if (!existsSync(input.torrentAbsPath)) {
    return { ok: false, notes: ['torrent file missing'], seedStatus: 'error' };
  }
  if (!existsSync(input.contentAbsPath)) {
    return { ok: false, notes: ['content missing'], seedStatus: 'error' };
  }
  if (seeds.has(input.share.id)) {
    return { ok: true, notes: ['already seeding'], seedStatus: 'seeding' };
  }
  const settings = loadBtTrackerSettings(input.dataDir);
  if (seeds.size >= settings.maxSeeds) {
    return {
      ok: false,
      notes: [tl('notes.btTracker.maxSeeds', { n: String(settings.maxSeeds) })],
      seedStatus: 'error',
    };
  }
  try {
    const c = await ensureClient();
    const torrent = await new Promise<SeedEntry['torrent']>((resolve, reject) => {
      const t = c.add(
        input.torrentAbsPath,
        {
          path: contentBasePath(input.contentAbsPath),
          destroyStore: false,
        },
        (ready) => resolve(ready || t),
      );
      t.on?.('error', (e: unknown) => {
        reject(e instanceof Error ? e : new Error(String(e)));
      });
      setTimeout(() => resolve(t), 15_000);
    });

    const infoHash = (
      input.share.infoHash ||
      String(torrent.infoHash || '')
    ).toLowerCase();
    seeds.set(input.share.id, {
      shareId: input.share.id,
      infoHash,
      torrent,
    });
    notes.push(tl('notes.btTracker.seedStarted', { id: input.share.id }));
    return { ok: true, notes, seedStatus: 'seeding' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notes.push(msg.slice(0, 240));
    return { ok: false, notes, seedStatus: 'error' };
  }
}

export async function stopSeed(shareId: string): Promise<{ ok: boolean; notes: string[] }> {
  const entry = seeds.get(shareId);
  if (!entry) return { ok: true, notes: ['not seeding'] };
  seeds.delete(shareId);
  await new Promise<void>((resolve) => {
    try {
      entry.torrent.destroy?.({ destroyStore: false }, () => resolve());
      setTimeout(() => resolve(), 2_000);
    } catch {
      resolve();
    }
  });
  return { ok: true, notes: [tl('notes.btTracker.seedStopped')] };
}

export function collectBtShareStats(input: {
  share: FileShareRecord;
  trackerSeeders?: number;
  trackerLeechers?: number;
}): BtShareStats {
  const entry = seeds.get(input.share.id);
  const t = entry?.torrent;
  const downloadSpeed = Number(t?.downloadSpeed) || 0;
  const uploadSpeed = Number(t?.uploadSpeed) || 0;
  const downloaded = Number(t?.downloaded) || 0;
  const uploaded = Number(t?.uploaded) || 0;
  const numPeers = Number(t?.numPeers) || 0;
  const seedsN =
    typeof input.trackerSeeders === 'number'
      ? input.trackerSeeders
      : entry
        ? 1
        : 0;
  const leechers =
    typeof input.trackerLeechers === 'number'
      ? input.trackerLeechers
      : Math.max(0, numPeers > 0 ? numPeers - (entry ? 1 : 0) : 0);
  const notes: string[] = [...(input.share.seedNotes || [])];
  if (input.share.seedStatus === 'pending') {
    notes.push(tl('notes.btTracker.seedPending'));
  }
  if (!entry && input.share.downloadModes?.includes('bt')) {
    if (!notes.some((n) => /seed/i.test(n))) {
      notes.push(tl('notes.btTracker.notSeeding'));
    }
  }
  const ratio = downloaded > 0 ? uploaded / downloaded : uploaded > 0 ? Number.POSITIVE_INFINITY : 0;
  return {
    infoHash: input.share.infoHash || entry?.infoHash || '',
    seedStatus: input.share.seedStatus || (entry ? 'seeding' : 'none'),
    localSeeding: Boolean(entry),
    peers: numPeers,
    seeds: seedsN,
    leechers,
    downloadSpeed,
    uploadSpeed,
    downloaded,
    uploaded,
    progress: t?.progress,
    ratio: Number.isFinite(ratio) ? ratio : undefined,
    numPeers,
    wireCount: numPeers,
    updatedAt: new Date().toISOString(),
    name: t?.name || input.share.path.split('/').pop(),
    sizeBytes: t?.length,
    notes: notes.slice(0, 6),
  };
}
