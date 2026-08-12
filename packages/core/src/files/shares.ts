/**
 * Public file share links (ownCloud-style link share).
 */

import type { JsonStore } from '../db/store.js';
import { ErrorCodes, YskError, tl} from 'ysk-server-shared';
import {
  hashSharePassword,
  newShareToken,
  verifySharePasswordHash,
  type FileShareRecord,
} from './manager.js';

function list(store: JsonStore): FileShareRecord[] {
  if (!Array.isArray(store.snapshot.file_shares)) {
    store.snapshot.file_shares = [];
  }
  return store.snapshot.file_shares as unknown as FileShareRecord[];
}

export function listFileShares(store: JsonStore, root?: string): FileShareRecord[] {
  const all = list(store);
  if (!root) return all.map((s) => ({ ...s }));
  return all.filter((s) => s.root === root).map((s) => ({ ...s }));
}

export function createFileShare(
  store: JsonStore,
  input: {
    root: string;
    path: string;
    password?: string;
    expiresAt?: string;
    createdBy: string;
    downloadModes?: Array<'direct' | 'bt'>;
    infoHash?: string;
    magnetUri?: string;
    torrentRelPath?: string;
    seedStatus?: FileShareRecord['seedStatus'];
    seedNotes?: string[];
  },
): FileShareRecord {
  if (!input.path || input.path === '.') {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.needPath'), { httpStatus: 400 });
  }
  const modes = normalizeDownloadModes(input.downloadModes);
  if (modes.includes('bt') && !input.infoHash && input.seedStatus !== 'pending') {
    // Allow pending: torrent may be created just after row insert by caller
  }
  const row: FileShareRecord = {
    id: newShareToken().slice(0, 12),
    token: newShareToken(),
    root: input.root,
    path: input.path.replace(/\\/g, '/'),
    passwordHash: input.password ? hashSharePassword(input.password) : undefined,
    expiresAt: input.expiresAt,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    downloadCount: 0,
    downloadModes: modes,
    infoHash: input.infoHash,
    magnetUri: input.magnetUri,
    torrentRelPath: input.torrentRelPath,
    seedStatus: input.seedStatus ?? (modes.includes('bt') ? 'pending' : 'none'),
    seedNotes: input.seedNotes,
  };
  list(store).unshift(row as unknown as FileShareRecord);
  store.persist();
  return { ...row };
}

export function normalizeDownloadModes(
  raw?: Array<'direct' | 'bt'> | string | null,
): Array<'direct' | 'bt'> {
  if (!raw) return ['direct'];
  if (typeof raw === 'string' && raw.trim().toLowerCase() === 'both') {
    return ['direct', 'bt'];
  }
  const list = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(/[|,]/)
        .map((s) => s.trim().toLowerCase());
  const out: Array<'direct' | 'bt'> = [];
  for (const m of list) {
    if (m === 'both') {
      if (!out.includes('direct')) out.push('direct');
      if (!out.includes('bt')) out.push('bt');
      continue;
    }
    if ((m === 'direct' || m === 'bt') && !out.includes(m)) out.push(m);
  }
  return out.length ? out : ['direct'];
}

export function patchFileShare(
  store: JsonStore,
  id: string,
  patch: Partial<FileShareRecord>,
): FileShareRecord | null {
  const items = list(store);
  const row = items.find((s) => s.id === id || s.token === id);
  if (!row) return null;
  Object.assign(row, patch, { id: row.id, token: row.token });
  store.persist();
  return { ...row };
}

export function getFileShareById(store: JsonStore, id: string): FileShareRecord | null {
  const row = list(store).find((s) => s.id === id || s.token === id) ?? null;
  return row ? { ...row } : null;
}

export function deleteFileShare(store: JsonStore, id: string): boolean {
  const before = list(store).length;
  store.snapshot.file_shares = list(store).filter(
    (s) => s.id !== id && s.token !== id,
  ) as unknown as Array<Record<string, unknown>>;
  store.persist();
  return list(store).length < before;
}

export function getShareByToken(store: JsonStore, token: string): FileShareRecord | null {
  const row = list(store).find((s) => s.token === token) ?? null;
  if (!row) return null;
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    return null;
  }
  return { ...row };
}

export function verifySharePassword(row: FileShareRecord, password?: string): boolean {
  if (!row.passwordHash) return true;
  if (!password) return false;
  return verifySharePasswordHash(row.passwordHash, password);
}

export function bumpShareDownload(store: JsonStore, token: string): void {
  const row = list(store).find((s) => s.token === token);
  if (row) {
    row.downloadCount = (row.downloadCount ?? 0) + 1;
    store.persist();
  }
}

export type FavoriteRecord = { root: string; path: string; createdAt: string };

export function listFavorites(store: JsonStore, root?: string): FavoriteRecord[] {
  if (!Array.isArray(store.snapshot.file_favorites)) store.snapshot.file_favorites = [];
  const all = store.snapshot.file_favorites as unknown as FavoriteRecord[];
  if (!root) return all.map((f) => ({ ...f }));
  return all.filter((f) => f.root === root).map((f) => ({ ...f }));
}

export function toggleFavorite(
  store: JsonStore,
  root: string,
  path: string,
): { favorited: boolean } {
  if (!Array.isArray(store.snapshot.file_favorites)) store.snapshot.file_favorites = [];
  const all = store.snapshot.file_favorites as unknown as FavoriteRecord[];
  const idx = all.findIndex((f) => f.root === root && f.path === path);
  if (idx >= 0) {
    all.splice(idx, 1);
    store.persist();
    return { favorited: false };
  }
  all.unshift({ root, path, createdAt: new Date().toISOString() });
  store.persist();
  return { favorited: true };
}
