/**
 * Sidebar nav bookmarks — pinned projects + email domains.
 */
import { api } from '../../shared/services/api';

export type NavBookmarkProject = {
  id: string;
  label: string;
  domain?: string;
};

export type NavBookmarkEmail = {
  id: string;
  domain: string;
};

export type NavBookmarks = {
  projects: NavBookmarkProject[];
  emailDomains: NavBookmarkEmail[];
};

export const navBookmarksApi = {
  get: () =>
    api.requestRaw<{ ok: boolean; bookmarks: NavBookmarks }>(
      '/api/v1/nav/bookmarks',
    ),
  put: (bookmarks: NavBookmarks) =>
    api.requestRaw<{ ok: boolean; bookmarks: NavBookmarks }>(
      '/api/v1/nav/bookmarks',
      { method: 'PUT', body: JSON.stringify({ bookmarks }) },
    ),
  toggle: (body: {
    kind: 'project' | 'email';
    id: string;
    label?: string;
    domain?: string;
  }) =>
    api.requestRaw<{
      ok: boolean;
      bookmarked: boolean;
      bookmarks: NavBookmarks;
    }>('/api/v1/nav/bookmarks/toggle', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
