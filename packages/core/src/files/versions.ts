import { tl } from '@ysk/shared';
/**
 * File version snapshots under .versions/<encoded-path>/
 */

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const VERSIONS_DIR = '.versions';
const MAX_VERSIONS = 20;

function encodePath(relPath: string): string {
  return createHash('sha256').update(relPath.replace(/\\/g, '/')).digest('hex').slice(0, 24);
}

export type FileVersionMeta = {
  id: string;
  path: string;
  createdAt: string;
  bytes: number;
  note?: string;
};

export function versionsRoot(sandboxRoot: string): string {
  const r = join(sandboxRoot, VERSIONS_DIR);
  mkdirSync(r, { recursive: true });
  return r;
}

export function snapshotFileVersion(
  sandboxRoot: string,
  absFile: string,
  relPath: string,
): FileVersionMeta | null {
  if (!existsSync(absFile) || !statSync(absFile).isFile()) return null;
  const st = statSync(absFile);
  if (st.size > 20 * 1024 * 1024) return null; // skip >20MB
  const dir = join(versionsRoot(sandboxRoot), encodePath(relPath));
  mkdirSync(dir, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dest = join(dir, id);
  copyFileSync(absFile, dest);
  const meta: FileVersionMeta = {
    id,
    path: relPath.replace(/\\/g, '/'),
    createdAt: new Date().toISOString(),
    bytes: st.size,
  };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(meta), 'utf8');
  // prune
  const metas = listFileVersions(sandboxRoot, relPath);
  if (metas.length > MAX_VERSIONS) {
    for (const old of metas.slice(MAX_VERSIONS)) {
      try {
        rmSync(join(dir, old.id), { force: true });
        rmSync(join(dir, `${old.id}.json`), { force: true });
      } catch {
        /* ignore */
      }
    }
  }
  return meta;
}

export function listFileVersions(sandboxRoot: string, relPath: string): FileVersionMeta[] {
  const dir = join(versionsRoot(sandboxRoot), encodePath(relPath));
  if (!existsSync(dir)) return [];
  const out: FileVersionMeta[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')) as FileVersionMeta);
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function restoreFileVersion(
  sandboxRoot: string,
  relPath: string,
  versionId: string,
  writeAbs: (content: Buffer) => void,
  currentAbs?: string,
): { ok: boolean; notes: string[] } {
  const safe = versionId.replace(/[^a-zA-Z0-9._-]/g, '');
  const dir = join(versionsRoot(sandboxRoot), encodePath(relPath));
  const src = join(dir, safe);
  if (!existsSync(src)) {
    return { ok: false, notes: [tl('notes.auto.n0865')] };
  }
  // snapshot current before restore
  if (currentAbs && existsSync(currentAbs)) {
    snapshotFileVersion(sandboxRoot, currentAbs, relPath);
  }
  const buf = readFileSync(src);
  writeAbs(buf);
  return { ok: true, notes: [tl('notes.auto.t0002', { v0: (safe) })] };
}

export function readVersionBytes(
  sandboxRoot: string,
  relPath: string,
  versionId: string,
): Buffer | null {
  const safe = versionId.replace(/[^a-zA-Z0-9._-]/g, '');
  const src = join(versionsRoot(sandboxRoot), encodePath(relPath), safe);
  if (!existsSync(src)) return null;
  return readFileSync(src);
}

