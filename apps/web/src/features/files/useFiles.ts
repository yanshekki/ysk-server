/**
 * Legacy hook — thin wrapper over public root.
 * Prefer FilesPage direct filesApi usage for full ownCloud features.
 */
import { useCallback, useEffect, useState } from 'react';
import { filesApi, type FileEntry } from './api';

const ROOT = 'public';

export function useFiles() {
  const [path, setPath] = useState('.');
  const [items, setItems] = useState<FileEntry[]>([]);
  const [content, setContent] = useState('');
  const [editPath, setEditPath] = useState('notes.txt');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(
    async (p = path) => {
      const r = await filesApi.list(ROOT, p);
      setItems(r.items);
      setPath(p);
    },
    [path],
  );

  useEffect(() => {
    void refresh('.').catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEntry = useCallback(
    async (e: FileEntry) => {
      setError(null);
      if (e.type === 'dir') {
        await refresh(e.path);
        return;
      }
      const r = await filesApi.read(ROOT, e.path);
      setEditPath(r.path);
      setContent(r.content);
    },
    [refresh],
  );

  const save = useCallback(
    async (targetPath: string, body: string) => {
      setError(null);
      try {
        await filesApi.write(ROOT, targetPath, body);
        setMsg(`Saved ${targetPath}`);
        await refresh(path);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'save failed');
        throw e;
      }
    },
    [path, refresh],
  );

  const mkdir = useCallback(async () => {
    const name = `folder-${Date.now()}`;
    const p = path === '.' ? name : `${path}/${name}`;
    await filesApi.mkdir(ROOT, p);
    await refresh(path);
  }, [path, refresh]);

  return {
    path,
    items,
    content,
    setContent,
    editPath,
    setEditPath,
    error,
    msg,
    refresh,
    openEntry,
    save,
    mkdir,
  };
}
