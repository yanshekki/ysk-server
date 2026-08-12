/**
 * Files feature — ownCloud-style sandboxed API client.
 */
import type { FileEntry, TrashEntry, FileShare } from '@ysk/shared';
import { api } from '../../shared/services/api';

export type { FileEntry, TrashEntry, FileShare } from '@ysk/shared';

function q(root: string, extra: Record<string, string | undefined> = {}) {
  const p = new URLSearchParams({ root });
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && v !== '') p.set(k, v);
  }
  return p.toString();
}

export const filesApi = {
  list: (
    root: string,
    path: string,
    opts?: { sort?: string; order?: string; q?: string },
  ) =>
    api.requestRaw<{
      items: FileEntry[];
      path: string;
      root: string;
      usage?: { bytes: number; fileCount: number; dirCount: number };
    }>(
      `/api/v1/files?${q(root, {
        path,
        sort: opts?.sort,
        order: opts?.order,
        q: opts?.q,
      })}`,
    ),

  read: (root: string, path: string) =>
    api.requestRaw<{ content: string; path: string; bytes: number; mime?: string }>(
      `/api/v1/files/read?${q(root, { path })}`,
    ),

  downloadUrl: (root: string, path: string) =>
    `/api/v1/files/download?${q(root, { path })}`,

  write: (root: string, path: string, content: string) =>
    api.requestRaw(`/api/v1/files/write?${q(root)}`, {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    }),

  upload: (root: string, dir: string, files: Array<{ name: string; base64: string }>) =>
    api.requestRaw<{ ok: boolean; results: Array<{ path: string; bytes: number }> }>(
      `/api/v1/files/upload?${q(root)}`,
      {
        method: 'POST',
        body: JSON.stringify({ dir, files }),
      },
    ),

  mkdir: (root: string, path: string) =>
    api.requestRaw(`/api/v1/files/mkdir?${q(root)}`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  createText: (root: string, path: string, content = '') =>
    api.requestRaw(`/api/v1/files/create-text?${q(root)}`, {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    }),

  chmod: (root: string, path: string, mode: string) =>
    api.requestRaw<{ path: string; mode: string }>(`/api/v1/files/chmod?${q(root)}`, {
      method: 'POST',
      body: JSON.stringify({ path, mode }),
    }),

  zip: (root: string, paths: string[], dest: string) =>
    api.requestRaw<{ ok: boolean; path: string; bytes: number; notes: string[] }>(
      `/api/v1/files/zip?${q(root)}`,
      {
        method: 'POST',
        body: JSON.stringify({ paths, dest }),
      },
    ),

  unzip: (root: string, zipPath: string, destDir = '.') =>
    api.requestRaw<{ ok: boolean; path: string; notes: string[] }>(
      `/api/v1/files/unzip?${q(root)}`,
      {
        method: 'POST',
        body: JSON.stringify({ zipPath, destDir }),
      },
    ),

  remove: (root: string, path: string, permanent = false) =>
    api.requestRaw(
      `/api/v1/files?${q(root, { path, permanent: permanent ? '1' : undefined })}`,
      { method: 'DELETE' },
    ),

  rename: (root: string, from: string, to: string) =>
    api.requestRaw(`/api/v1/files/rename?${q(root)}`, {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),

  copy: (root: string, from: string, to: string) =>
    api.requestRaw(`/api/v1/files/copy?${q(root)}`, {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),

  move: (root: string, from: string, to: string) =>
    api.requestRaw(`/api/v1/files/move?${q(root)}`, {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),

  trash: (root: string) =>
    api.requestRaw<{ items: TrashEntry[] }>(`/api/v1/files/trash?${q(root)}`),

  restoreTrash: (root: string, trashId: string) =>
    api.requestRaw(`/api/v1/files/trash/restore?${q(root)}`, {
      method: 'POST',
      body: JSON.stringify({ trashId }),
    }),

  purgeTrash: (root: string, trashId?: string) =>
    api.requestRaw(
      `/api/v1/files/trash?${q(root, { trashId })}`,
      { method: 'DELETE' },
    ),

  listShares: (root: string) =>
    api.requestRaw<{ items: FileShare[] }>(`/api/v1/files/shares?${q(root)}`),

  createShare: (
    root: string,
    body: {
      path: string;
      password?: string;
      expiresAt?: string;
      /** direct | bt | both — or explicit downloadModes */
      mode?: 'direct' | 'bt' | 'both';
      downloadModes?: Array<'direct' | 'bt'>;
    },
  ) =>
    api.requestRaw<{ share: FileShare; notes?: string[]; ok?: boolean }>(
      `/api/v1/files/shares?${q(root)}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),

  shareBtStats: (id: string) =>
    api.requestRaw<{ ok: boolean; stats: import('@ysk/shared').BtShareStats }>(
      `/api/v1/files/shares/${encodeURIComponent(id)}/bt-stats`,
    ),

  shareBtStatsBatch: (ids: string[]) =>
    api.requestRaw<{ ok: boolean; items: Record<string, import('@ysk/shared').BtShareStats> }>(
      '/api/v1/files/shares/bt-stats',
      { method: 'POST', body: JSON.stringify({ ids }) },
    ),

  deleteShare: (root: string, id: string) =>
    api.requestRaw(`/api/v1/files/shares/${encodeURIComponent(id)}?${q(root)}`, {
      method: 'DELETE',
    }),

  toggleFavorite: (root: string, path: string) =>
    api.requestRaw<{ favorited: boolean }>(`/api/v1/files/favorites/toggle?${q(root)}`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  listFavorites: (root: string) =>
    api.requestRaw<{ items: Array<{ root: string; path: string }> }>(
      `/api/v1/files/favorites?${q(root)}`,
    ),

  listVersions: (root: string, path: string) =>
    api.requestRaw<{
      items: Array<{ id: string; path: string; createdAt: string; bytes: number }>;
      path: string;
    }>(`/api/v1/files/versions?${q(root, { path })}`),

  restoreVersion: (root: string, path: string, versionId: string) =>
    api.requestRaw<{ ok: boolean; notes: string[] }>(
      `/api/v1/files/versions/restore?${q(root)}`,
      {
        method: 'POST',
        body: JSON.stringify({ path, versionId }),
      },
    ),

  webdavStatus: () =>
    api.requestRaw<{
      enabled: boolean;
      mountPath: string;
      tokenId?: string;
      updated_at?: string;
    }>('/api/v1/files/webdav?root=public'),

  webdavIssueToken: () =>
    api.requestRaw<{
      ok: boolean;
      token: string;
      tokenId?: string;
      mountPath: string;
      notes: string[];
      updated_at?: string;
    }>('/api/v1/files/webdav/token?root=public', { method: 'POST', body: '{}' }),

  webdavDisable: () =>
    api.requestRaw<{ ok: boolean; enabled?: boolean }>('/api/v1/files/webdav/disable?root=public', {
      method: 'POST',
      body: '{}',
    }),
};

/** Read file as base64 via FileReader; optional 0–1 progress while reading */
export function fileToBase64(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.min(1, ev.loaded / Math.max(1, ev.total)));
      }
    };
    reader.onload = () => {
      onProgress?.(1);
      const r = String(reader.result ?? '');
      const i = r.indexOf(',');
      resolve(i >= 0 ? r.slice(i + 1) : r);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
