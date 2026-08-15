/**
 * Re-add library torrents into the in-process WebTorrent client on boot.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tl } from 'ysk-server-shared';
import { loadBtTrackerSettings } from './settings.js';
import { loadBtLibrary, patchBtLibraryItem } from './library.js';
import { addLibrarySeed, listLocalSeeds } from './seeder.js';
import { resolveLibraryDestAbs } from './library-ops.js';

export type RestoreBtLibraryResult = {
  ok: boolean;
  attempted: number;
  started: number;
  failed: number;
  skipped: number;
  notes: string[];
};

export async function restoreBtLibraryOnBoot(input: {
  dataDir: string;
  limit?: number;
}): Promise<RestoreBtLibraryResult> {
  const notes: string[] = [];
  const settings = loadBtTrackerSettings(input.dataDir);
  const items = loadBtLibrary(input.dataDir).filter((i) => i.status !== 'paused');
  const limit = Math.min(input.limit ?? settings.maxSeeds, settings.maxSeeds, 64);
  let attempted = 0;
  let started = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of items) {
    if (listLocalSeeds().length >= limit || attempted >= limit) {
      skipped += 1;
      continue;
    }
    const torrentAbs = item.torrentRelPath
      ? join(input.dataDir, item.torrentRelPath)
      : '';
    const hasTorrent = Boolean(torrentAbs && existsSync(torrentAbs));
    if (!hasTorrent && !item.magnetUri) {
      skipped += 1;
      continue;
    }
    attempted += 1;
    try {
      const dest = resolveLibraryDestAbs(input.dataDir, item.saveRoot, item.saveRelPath);
      const r = await addLibrarySeed({
        dataDir: input.dataDir,
        id: item.id,
        destAbs: dest.destAbs,
        torrentAbsPath: hasTorrent ? torrentAbs : undefined,
        magnetUri: item.magnetUri,
      });
      patchBtLibraryItem(input.dataDir, item.id, {
        status: r.status,
        errorNote: r.ok ? undefined : r.notes.join('; ').slice(0, 400),
      });
      if (r.ok) started += 1;
      else failed += 1;
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      patchBtLibraryItem(input.dataDir, item.id, { status: 'error', errorNote: msg.slice(0, 200) });
    }
  }

  if (attempted > 0) {
    notes.push(
      tl('notes.btTracker.libraryRestoreDone', {
        started: String(started),
        attempted: String(attempted),
        failed: String(failed),
      }),
    );
  }

  return { ok: failed === 0 || started > 0, attempted, started, failed, skipped, notes };
}
