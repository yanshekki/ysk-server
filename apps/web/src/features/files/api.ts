/**
 * Files feature — sandboxed public root API.
 */
import { api } from '../../shared/services/api';

export type FileEntry = {
  name: string;
  path: string;
  type: string;
  size: number;
  mtime: string;
};

export const filesApi = {
  list: (path: string) =>
    api.requestRaw<{ items: FileEntry[] }>(
      `/api/v1/files?root=public&path=${encodeURIComponent(path)}`,
    ),
  read: (path: string) =>
    api.requestRaw<{ content: string; path: string }>(
      `/api/v1/files/read?root=public&path=${encodeURIComponent(path)}`,
    ),
  write: (path: string, content: string) =>
    api.requestRaw('/api/v1/files/write?root=public', {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    }),
  mkdir: (path: string) =>
    api.requestRaw('/api/v1/files/mkdir?root=public', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
};
