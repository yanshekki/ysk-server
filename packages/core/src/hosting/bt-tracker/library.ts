/**
 * Persist WebTorrent library items (imported .torrent / magnet → dest folder).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BtLibraryItem, BtLibraryStatus } from 'ysk-server-shared';

function libraryPath(dataDir: string): string {
  return join(dataDir, 'bt', 'library.json');
}

export function torrentStoreDir(dataDir: string): string {
  return join(dataDir, 'bt', 'torrents');
}

function normalizeItem(raw: Partial<BtLibraryItem>): BtLibraryItem | null {
  const id = String(raw.id || '').trim();
  const infoHash = String(raw.infoHash || '')
    .trim()
    .toLowerCase();
  if (!id || !/^[a-f0-9]{40}$/.test(infoHash)) return null;
  const status = normalizeStatus(raw.status);
  const now = new Date().toISOString();
  return {
    id,
    infoHash,
    name: String(raw.name || infoHash).trim() || infoHash,
    torrentRelPath: raw.torrentRelPath ? String(raw.torrentRelPath) : undefined,
    saveRoot: String(raw.saveRoot || 'public').trim() || 'public',
    saveRelPath: String(raw.saveRelPath || '').replace(/^\/+/, ''),
    source: raw.source === 'share' ? 'share' : 'library',
    shareId: raw.shareId ? String(raw.shareId) : undefined,
    status,
    magnetUri: raw.magnetUri ? String(raw.magnetUri) : undefined,
    sizeBytes: Number.isFinite(Number(raw.sizeBytes)) ? Number(raw.sizeBytes) : undefined,
    errorNote: raw.errorNote ? String(raw.errorNote).slice(0, 400) : undefined,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

function normalizeStatus(s: unknown): BtLibraryStatus {
  const v = String(s || '');
  if (
    v === 'queued' ||
    v === 'checking' ||
    v === 'downloading' ||
    v === 'seeding' ||
    v === 'paused' ||
    v === 'error'
  ) {
    return v;
  }
  return 'queued';
}

export function loadBtLibrary(dataDir: string): BtLibraryItem[] {
  const p = libraryPath(dataDir);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { items?: unknown };
    const items = Array.isArray(raw.items) ? raw.items : [];
    return items
      .map((row) => normalizeItem(row as Partial<BtLibraryItem>))
      .filter((x): x is BtLibraryItem => Boolean(x));
  } catch {
    return [];
  }
}

function saveBtLibrary(dataDir: string, items: BtLibraryItem[]): void {
  mkdirSync(join(dataDir, 'bt'), { recursive: true });
  writeFileSync(
    libraryPath(dataDir),
    JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}

export function getBtLibraryItem(dataDir: string, id: string): BtLibraryItem | undefined {
  return loadBtLibrary(dataDir).find((i) => i.id === id);
}

export function getBtLibraryByHash(
  dataDir: string,
  infoHash: string,
): BtLibraryItem | undefined {
  const h = String(infoHash || '')
    .trim()
    .toLowerCase();
  return loadBtLibrary(dataDir).find((i) => i.infoHash === h);
}

export function upsertBtLibraryItem(dataDir: string, item: BtLibraryItem): BtLibraryItem {
  const items = loadBtLibrary(dataDir);
  const next = { ...item, updatedAt: new Date().toISOString() };
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) items[idx] = next;
  else items.unshift(next);
  saveBtLibrary(dataDir, items);
  return next;
}

export function patchBtLibraryItem(
  dataDir: string,
  id: string,
  patch: Partial<BtLibraryItem>,
): BtLibraryItem | undefined {
  const items = loadBtLibrary(dataDir);
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return undefined;
  const next = normalizeItem({ ...items[idx], ...patch, id, updatedAt: new Date().toISOString() });
  if (!next) return undefined;
  items[idx] = next;
  saveBtLibrary(dataDir, items);
  return next;
}

export function removeBtLibraryItem(dataDir: string, id: string): boolean {
  const items = loadBtLibrary(dataDir);
  const next = items.filter((i) => i.id !== id);
  if (next.length === items.length) return false;
  saveBtLibrary(dataDir, next);
  return true;
}
