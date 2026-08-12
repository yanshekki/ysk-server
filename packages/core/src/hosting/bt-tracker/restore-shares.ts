/**
 * On control-plane boot: start tracker (if autostart / needed) and re-seed BT file shares.
 * Seeds live in-process — must run inside `ysk-server serve`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import { publicFilesRoot } from '../../files/manager.js';
import { listFileShares, patchFileShare } from '../../files/shares.js';
import { projectHomeDir } from '../project.js';
import { loadBtTrackerSettings } from './settings.js';
import { isBtTrackerRunning, startBtTracker } from './service.js';
import { seedShare } from './seeder.js';
import { tl } from 'ysk-server-shared';

export type RestoreBtSharesResult = {
  ok: boolean;
  trackerStarted: boolean;
  trackerRunning: boolean;
  attempted: number;
  seeded: number;
  failed: number;
  skipped: number;
  notes: string[];
};

function resolveShareContentAbs(
  dataDir: string,
  rootKey: string,
  relPath: string,
): string | null {
  const rel = String(relPath || '').replace(/^\/+/, '');
  if (!rel || rel.includes('\0') || rel.split(/[/\\]/).some((s) => s === '..')) {
    return null;
  }
  let root: string;
  if (rootKey === 'public' || !rootKey) {
    root = publicFilesRoot(dataDir);
  } else if (rootKey.startsWith('project:')) {
    const projectId = rootKey.slice('project:'.length).trim();
    if (!projectId) return null;
    try {
      root = projectHomeDir(projectId);
    } catch {
      return null;
    }
  } else {
    root = publicFilesRoot(dataDir);
  }
  return join(root, rel);
}

/**
 * Start tracker when autostart is on, or when there are BT shares to seed.
 * Re-seed shares that have downloadModes including `bt` and a torrent file on disk.
 */
export async function restoreBtSharesOnBoot(input: {
  dataDir: string;
  db: JsonStore;
  host: HostExecutor;
  /** Max shares to re-seed this boot (default settings.maxSeeds) */
  limit?: number;
}): Promise<RestoreBtSharesResult> {
  const notes: string[] = [];
  const settings = loadBtTrackerSettings(input.dataDir);
  const shares = listFileShares(input.db).filter((s) => {
    const modes = s.downloadModes ?? ['direct'];
    return modes.includes('bt') || Boolean(s.infoHash) || Boolean(s.torrentRelPath);
  });

  let trackerStarted = false;
  const needTracker = settings.autostart || shares.length > 0;
  if (needTracker && !isBtTrackerRunning()) {
    const r = await startBtTracker({ dataDir: input.dataDir, host: input.host });
    notes.push(...r.notes.slice(0, 3));
    trackerStarted = r.ok;
    if (!r.ok) {
      notes.push(tl('notes.btTracker.restoreTrackerFailed'));
    }
  }

  const limit = Math.min(
    input.limit ?? settings.maxSeeds,
    settings.maxSeeds,
    64,
  );
  let attempted = 0;
  let seeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const share of shares) {
    if (attempted >= limit) {
      skipped += 1;
      continue;
    }
    if (share.seedStatus === 'stopped') {
      skipped += 1;
      continue;
    }
    if (!share.torrentRelPath) {
      skipped += 1;
      continue;
    }
    const torrentAbs = join(input.dataDir, share.torrentRelPath);
    if (!existsSync(torrentAbs)) {
      failed += 1;
      patchFileShare(input.db, share.id, {
        seedStatus: 'error',
        seedNotes: ['torrent missing on disk at restore'],
      });
      continue;
    }
    const contentAbs = resolveShareContentAbs(input.dataDir, share.root, share.path);
    if (!contentAbs || !existsSync(contentAbs)) {
      failed += 1;
      patchFileShare(input.db, share.id, {
        seedStatus: 'error',
        seedNotes: ['content missing on disk at restore'],
      });
      continue;
    }
    attempted += 1;
    try {
      const r = await seedShare({
        dataDir: input.dataDir,
        share,
        contentAbsPath: contentAbs,
        torrentAbsPath: torrentAbs,
      });
      patchFileShare(input.db, share.id, {
        seedStatus: r.seedStatus,
        seedNotes: [...(share.seedNotes || []).slice(0, 4), ...r.notes].slice(0, 8),
      });
      if (r.ok) seeded += 1;
      else failed += 1;
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      patchFileShare(input.db, share.id, {
        seedStatus: 'error',
        seedNotes: [msg.slice(0, 200)],
      });
    }
  }

  if (seeded > 0 || attempted > 0) {
    notes.push(
      tl('notes.btTracker.restoreDone', {
        seeded: String(seeded),
        attempted: String(attempted),
        failed: String(failed),
      }),
    );
  }

  return {
    ok: failed === 0 || seeded > 0,
    trackerStarted,
    trackerRunning: isBtTrackerRunning(),
    attempted,
    seeded,
    failed,
    skipped,
    notes,
  };
}
