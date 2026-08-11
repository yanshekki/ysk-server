/**
 * Load / toggle sidebar bookmarks (projects + email domains).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  navBookmarksApi,
  type NavBookmarks,
} from '../../features/nav-bookmarks/api';

const empty: NavBookmarks = { projects: [], emailDomains: [] };

export function useNavBookmarks() {
  const [bookmarks, setBookmarks] = useState<NavBookmarks>(empty);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await navBookmarksApi.get();
      setBookmarks(r.bookmarks ?? empty);
    } catch {
      /* keep last */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
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
      setBookmarks(r.bookmarks ?? empty);
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
      setBookmarks(r.bookmarks ?? empty);
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
