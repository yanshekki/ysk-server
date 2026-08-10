/**
 * Host-browse download records (server-side only; operator fetches via API).
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

export type BrowseDownloadStatus = 'pending' | 'completed' | 'blocked' | 'failed';

export type BrowseDownload = {
  id: string;
  sessionId: string;
  userId: string;
  filename: string;
  sourceUrl: string;
  mime: string | null;
  size: number;
  /** Absolute path on host when completed */
  absPath: string | null;
  status: BrowseDownloadStatus;
  reason?: string;
  createdAt: string;
  finishedAt?: string;
};

export type BrowseDownloadPublic = Omit<BrowseDownload, 'absPath' | 'userId'> & {
  hasFile: boolean;
};

export function toPublicDownload(d: BrowseDownload): BrowseDownloadPublic {
  return {
    id: d.id,
    sessionId: d.sessionId,
    filename: d.filename,
    sourceUrl: d.sourceUrl,
    mime: d.mime,
    size: d.size,
    status: d.status,
    reason: d.reason,
    createdAt: d.createdAt,
    finishedAt: d.finishedAt,
    hasFile: d.status === 'completed' && !!d.absPath && existsSync(d.absPath),
  };
}

export function safeFilename(name: string): string {
  const base = basename(name || 'download').replace(/[^\w.\-()+@ ]+/g, '_');
  const trimmed = base.slice(0, 180) || 'download';
  return trimmed;
}

export function downloadDir(
  dataDir: string,
  userId: string,
  sessionId: string,
): string {
  return join(dataDir, 'host-browse', 'downloads', userId, sessionId);
}

export function ensureDownloadDir(
  dataDir: string,
  userId: string,
  sessionId: string,
): string {
  const dir = downloadDir(dataDir, userId, sessionId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function newDownloadId(): string {
  return randomBytes(8).toString('hex');
}

export function absPathFor(
  dataDir: string,
  userId: string,
  sessionId: string,
  downloadId: string,
  filename: string,
): string {
  const dir = join(downloadDir(dataDir, userId, sessionId), downloadId);
  mkdirSync(dir, { recursive: true });
  return join(dir, safeFilename(filename));
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function tryUnlink(path: string | null | undefined): void {
  if (!path) return;
  try {
    unlinkSync(path);
  } catch {
    /* */
  }
}
