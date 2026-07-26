/**
 * Public file share links (ownCloud-style link share).
 */

import type { JsonStore } from '../db/store.js';
import { ErrorCodes, YskError } from '@ysk/shared';
import { hashSharePassword, newShareToken, type FileShareRecord } from './manager.js';

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
  },
): FileShareRecord {
  if (!input.path || input.path === '.') {
    throw new YskError(ErrorCodes.VALIDATION, 'path required', { httpStatus: 400 });
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
  };
  list(store).unshift(row as unknown as FileShareRecord);
  store.persist();
  return { ...row };
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
  return hashSharePassword(password) === row.passwordHash;
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
