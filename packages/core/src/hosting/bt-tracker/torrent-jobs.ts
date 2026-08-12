/**
 * Background queue for large BT share torrent creation + seeding.
 * Keeps HTTP share-create snappy for big trees.
 */
import type { JsonStore } from '../../db/store.js';
import type { FileShareRecord } from '../../files/manager.js';
import { patchFileShare } from '../../files/shares.js';
import { prepareFileShareBt } from './prepare-share-bt.js';
import { estimateContentBytes } from './torrent-create.js';
import { tl } from 'ysk-server-shared';

/** Sync create when content is smaller than this (bytes). */
export const BT_TORRENT_SYNC_MAX_BYTES = 128 * 1024 * 1024; // 128 MiB

export type TorrentJobStatus = 'queued' | 'running' | 'done' | 'error';

export type TorrentJob = {
  id: string;
  shareId: string;
  status: TorrentJobStatus;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  notes: string[];
  estimatedBytes?: number;
};

type InternalJob = TorrentJob & {
  dataDir: string;
  db: JsonStore;
  share: FileShareRecord;
  contentAbsPath: string;
  displayName?: string;
  publicHostHint?: string | null;
};

const jobs = new Map<string, InternalJob>();
const queue: string[] = [];
let pumping = false;

export function listTorrentJobs(): TorrentJob[] {
  return [...jobs.values()]
    .map(({ dataDir: _d, db: _b, share: _s, contentAbsPath: _c, ...pub }) => pub)
    .sort((a, b) => b.enqueuedAt.localeCompare(a.enqueuedAt))
    .slice(0, 100);
}

export function getTorrentJob(idOrShareId: string): TorrentJob | null {
  for (const j of jobs.values()) {
    if (j.id === idOrShareId || j.shareId === idOrShareId) {
      const { dataDir: _d, db: _b, share: _s, contentAbsPath: _c, ...pub } = j;
      return pub;
    }
  }
  return null;
}

export function shouldCreateTorrentAsync(contentAbsPath: string): {
  async: boolean;
  estimatedBytes: number;
} {
  const estimatedBytes = estimateContentBytes(contentAbsPath);
  return {
    estimatedBytes,
    async: estimatedBytes >= BT_TORRENT_SYNC_MAX_BYTES,
  };
}

/**
 * Enqueue background prepareFileShareBt. Returns job id immediately.
 */
export function enqueueShareTorrentJob(input: {
  dataDir: string;
  db: JsonStore;
  share: FileShareRecord;
  contentAbsPath: string;
  displayName?: string;
  publicHostHint?: string | null;
  estimatedBytes?: number;
}): TorrentJob {
  const id = `tj_${input.share.id}_${Date.now().toString(36)}`;
  const job: InternalJob = {
    id,
    shareId: input.share.id,
    status: 'queued',
    enqueuedAt: new Date().toISOString(),
    notes: [tl('notes.btTracker.jobQueued')],
    estimatedBytes: input.estimatedBytes,
    dataDir: input.dataDir,
    db: input.db,
    share: input.share,
    contentAbsPath: input.contentAbsPath,
    displayName: input.displayName,
    publicHostHint: input.publicHostHint,
  };
  jobs.set(id, job);
  queue.push(id);
  patchFileShare(input.db, input.share.id, {
    seedStatus: 'pending',
    seedNotes: job.notes,
  });
  void pumpQueue();
  const { dataDir: _d, db: _b, share: _s, contentAbsPath: _c, ...pub } = job;
  return pub;
}

async function pumpQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      const job = jobs.get(id);
      if (!job) continue;
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      job.notes = [tl('notes.btTracker.jobRunning')];
      try {
        const r = await prepareFileShareBt({
          dataDir: job.dataDir,
          db: job.db,
          share: job.share,
          contentAbsPath: job.contentAbsPath,
          displayName: job.displayName,
          publicHostHint: job.publicHostHint,
        });
        job.status = r.share.seedStatus === 'error' ? 'error' : 'done';
        job.notes = r.notes.slice(0, 8);
        job.finishedAt = new Date().toISOString();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        job.status = 'error';
        job.notes = [msg.slice(0, 240)];
        job.finishedAt = new Date().toISOString();
        patchFileShare(job.db, job.shareId, {
          seedStatus: 'error',
          seedNotes: job.notes,
        });
      }
    }
  } finally {
    pumping = false;
  }
}

/** Test helper */
export function _resetTorrentJobsForTests(): void {
  jobs.clear();
  queue.length = 0;
  pumping = false;
}
