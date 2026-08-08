/**
 * Harden panel dataDir mode so other users cannot read control-plane JSON.
 * Target mode: 0750 (owner rwx, group rx, other none).
 */

import { chmodSync, existsSync, statSync } from 'node:fs';

export const DATADIR_HARDENED_MODE = 0o750;

export function dataDirMode(dataDir: string): number | null {
  try {
    if (!existsSync(dataDir)) return null;
    return statSync(dataDir).mode & 0o777;
  } catch {
    return null;
  }
}

/** True when other has read or write on dataDir (needs harden). */
export function dataDirNeedsHarden(dataDir: string): boolean {
  const mode = dataDirMode(dataDir);
  if (mode == null) return false;
  return (mode & 0o007) !== 0;
}

/**
 * chmod dataDir to 0750. Does not chown (panel must already own the path).
 */
export function hardenDataDirPerms(dataDir: string): {
  ok: boolean;
  path: string;
  before?: string;
  after?: string;
  notes: string[];
} {
  const notes: string[] = [];
  if (!dataDir || dataDir === '/' || dataDir === '.') {
    return { ok: false, path: dataDir, notes: ['invalid dataDir'] };
  }
  if (!existsSync(dataDir)) {
    return { ok: false, path: dataDir, notes: ['dataDir missing'] };
  }
  try {
    const before = dataDirMode(dataDir);
    const beforeStr = before != null ? before.toString(8) : '?';
    chmodSync(dataDir, DATADIR_HARDENED_MODE);
    const after = dataDirMode(dataDir);
    const afterStr = after != null ? after.toString(8) : '?';
    notes.push(`chmod ${beforeStr} → ${afterStr}`);
    const stillOpen = after != null && (after & 0o007) !== 0;
    if (stillOpen) {
      notes.push('mode still allows other access — check filesystem ACLs/mount options');
      return { ok: false, path: dataDir, before: beforeStr, after: afterStr, notes };
    }
    return { ok: true, path: dataDir, before: beforeStr, after: afterStr, notes };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notes.push(msg);
    return { ok: false, path: dataDir, notes };
  }
}
