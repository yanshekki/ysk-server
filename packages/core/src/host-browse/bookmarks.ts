/**
 * Per-operator bookmarks / history / home for host-browse (persisted via settings JSON).
 */

import { randomBytes } from 'node:crypto';

export type BrowseBookmark = {
  id: string;
  title: string;
  url: string;
  createdAt: string;
};

export type BrowseHistoryEntry = {
  id: string;
  title: string;
  url: string;
  at: string;
};

export type BrowseUserLibrary = {
  homeUrl: string;
  bookmarks: BrowseBookmark[];
  history: BrowseHistoryEntry[];
  /** Last session snapshot for resume (URLs only, no cookies) */
  lastSnapshot?: {
    tabs: Array<{ url: string; title?: string }>;
    activeIndex: number;
    mode: string;
    engine: string;
    updatedAt: string;
  };
};

export function emptyLibrary(): BrowseUserLibrary {
  return {
    homeUrl: 'https://www.google.com/',
    bookmarks: [],
    history: [],
  };
}

export function upsertBookmark(
  lib: BrowseUserLibrary,
  input: { url: string; title?: string },
): BrowseUserLibrary {
  const url = input.url.trim();
  if (!url) return lib;
  const existing = lib.bookmarks.find((b) => b.url === url);
  if (existing) {
    return {
      ...lib,
      bookmarks: lib.bookmarks.filter((b) => b.url !== url),
    };
  }
  const b: BrowseBookmark = {
    id: randomBytes(8).toString('hex'),
    title: (input.title || url).slice(0, 200),
    url,
    createdAt: new Date().toISOString(),
  };
  return { ...lib, bookmarks: [b, ...lib.bookmarks].slice(0, 200) };
}

export function removeBookmark(lib: BrowseUserLibrary, id: string): BrowseUserLibrary {
  return { ...lib, bookmarks: lib.bookmarks.filter((b) => b.id !== id) };
}

export function pushHistory(
  lib: BrowseUserLibrary,
  input: { url: string; title?: string },
): BrowseUserLibrary {
  const url = input.url.trim();
  if (!url || url === 'about:blank') return lib;
  const entry: BrowseHistoryEntry = {
    id: randomBytes(8).toString('hex'),
    title: (input.title || url).slice(0, 200),
    url,
    at: new Date().toISOString(),
  };
  const rest = lib.history.filter((h) => h.url !== url);
  return { ...lib, history: [entry, ...rest].slice(0, 200) };
}

export function setHome(lib: BrowseUserLibrary, homeUrl: string): BrowseUserLibrary {
  const u = homeUrl.trim() || 'https://www.google.com/';
  return { ...lib, homeUrl: u };
}

export function saveSnapshot(
  lib: BrowseUserLibrary,
  snap: NonNullable<BrowseUserLibrary['lastSnapshot']>,
): BrowseUserLibrary {
  return { ...lib, lastSnapshot: { ...snap, updatedAt: new Date().toISOString() } };
}
