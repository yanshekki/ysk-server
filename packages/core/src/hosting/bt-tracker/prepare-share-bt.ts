/**
 * Create .torrent + start seeder for a file share (panel API + CLI).
 */
import type { JsonStore } from '../../db/store.js';
import type { FileShareRecord } from '../../files/manager.js';
import { patchFileShare } from '../../files/shares.js';
import { isBtTrackerRunning } from './service.js';
import { loadBtTrackerSettings } from './settings.js';
import { createShareTorrent } from './torrent-create.js';
import { seedShare } from './seeder.js';
import { tl } from '@yanshekki/shared';

export async function prepareFileShareBt(input: {
  dataDir: string;
  db: JsonStore;
  share: FileShareRecord;
  contentAbsPath: string;
  displayName?: string;
  publicHostHint?: string | null;
}): Promise<{ share: FileShareRecord; notes: string[] }> {
  const notes: string[] = [];
  if (!isBtTrackerRunning()) {
    notes.push(tl('notes.btTracker.btNeedsTracker'));
  }
  const settings = loadBtTrackerSettings(input.dataDir);
  const tor = await createShareTorrent({
    dataDir: input.dataDir,
    contentAbsPath: input.contentAbsPath,
    shareId: input.share.id,
    settings,
    publicHostHint: input.publicHostHint,
    name: input.displayName,
  });
  let share = input.share;
  if (tor.ok && tor.infoHash) {
    share =
      patchFileShare(input.db, share.id, {
        infoHash: tor.infoHash,
        magnetUri: tor.magnetUri,
        torrentRelPath: tor.torrentRelPath,
        seedStatus: 'pending',
        seedNotes: tor.notes,
      }) ?? share;
    const seed = await seedShare({
      dataDir: input.dataDir,
      share,
      contentAbsPath: input.contentAbsPath,
      torrentAbsPath: tor.torrentAbsPath!,
    });
    share =
      patchFileShare(input.db, share.id, {
        seedStatus: seed.seedStatus,
        seedNotes: [...(share.seedNotes || []), ...seed.notes].slice(0, 8),
      }) ?? share;
    notes.push(...seed.notes);
  } else {
    share =
      patchFileShare(input.db, share.id, {
        seedStatus: 'error',
        seedNotes: tor.notes,
      }) ?? share;
    notes.push(...tor.notes);
  }
  return { share, notes };
}
