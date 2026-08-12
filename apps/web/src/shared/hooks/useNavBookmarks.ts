/**
 * Load / toggle sidebar bookmarks (projects + email domains).
 * Backed by navBookmarksStore so AppShell + pages share one list and
 * re-render immediately when any surface toggles a pin.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  navBookmarksApi,
  type NavBookmarks,
} from '../../features/nav-bookmarks/api';
import {
  EMPTY_NAV_BOOKMARKS,
  navBookmarksStore,
} from '../stores/nav-bookmarks-store';

export function useNavBookmarks() {
  const bookmarks = useSyncExternalStore(
    (onStoreChange) => navBookmarksStore.subscribe(onStoreChange),
    () => navBookmarksStore.get(),
    () => EMPTY_NAV_BOOKMARKS,
  );
  const loaded = useSyncExternalStore(
    (onStoreChange) => navBookmarksStore.subscribe(onStoreChange),
    () => navBookmarksStore.isLoaded(),
    () => false,
  );

  const refresh = useCallback(async () => {
    try {
      const r = await navBookmarksApi.get();
      navBookmarksStore.set(r.bookmarks ?? EMPTY_NAV_BOOKMARKS);
    } catch {
      navBookmarksStore.markLoaded();
    }
  }, []);

  useEffect(() => {
    // One shared load: skip if another consumer already loaded
    if (!navBookmarksStore.isLoaded()) {
      void refresh();
    }
  }, [refresh]);

  const isProjectBookmarked = useCallback(
    (id: string) => bookmarks.projects.some((p) => p.id === id),
    [bookmarks.projects],
  );

  const isEmailBookmarked = useCallback(
    (id: string) =>
      bookmarks.emailDomains.some((e) => e.id === id || e.domain === id),
    [bookmarks.emailDomains],
  );

  const toggleProject = useCallback(
    async (input: { id: string; label: string; domain?: string }) => {
      const r = await navBookmarksApi.toggle({
        kind: 'project',
        id: input.id,
        label: input.label,
        domain: input.domain,
      });
      navBookmarksStore.set(r.bookmarks ?? EMPTY_NAV_BOOKMARKS);
      return Boolean(r.bookmarked);
    },
    [],
  );

  const toggleEmail = useCallback(
    async (input: { id: string; domain: string }) => {
      const r = await navBookmarksApi.toggle({
        kind: 'email',
        id: input.id,
        domain: input.domain,
        label: input.domain,
      });
      navBookmarksStore.set(r.bookmarks ?? EMPTY_NAV_BOOKMARKS);
      return Boolean(r.bookmarked);
    },
    [],
  );

  return {
    bookmarks,
    loaded,
    refresh,
    isProjectBookmarked,
    isEmailBookmarked,
    toggleProject,
    toggleEmail,
  };
}

export type { NavBookmarks };
