import { useCallback, useEffect, useState } from 'react';
import { resourcesApi, type ResourceRow } from './api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

export function useResourceCrud(collection: string, query?: Record<string, string>) {
  const [items, setItems] = useState<ResourceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastNotes, setLastNotes] = useState<string[]>([]);
  const queryKey = query ? JSON.stringify(query) : '';

  const refresh = useCallback(async () => {
    const q = queryKey ? (JSON.parse(queryKey) as Record<string, string>) : undefined;
    const r = await resourcesApi.list(collection, q);
    setItems(r.items);
    return r.items;
  }, [collection, queryKey]);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const create = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await resourcesApi.create(collection, body);
        await refresh();
        setMsg('已建立');
        return r.item;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'create failed');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [collection, refresh],
  );

  const update = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await resourcesApi.update(collection, id, body);
        await refresh();
        setMsg('已更新');
        return r.item;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'update failed');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [collection, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        await resourcesApi.remove(collection, id);
        await refresh();
        setMsg('已刪除');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'delete failed');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [collection, refresh],
  );

  /** Always execute from admin panel (execute defaults true). */
  const apply = useCallback(
    async (id: string, execute = true) => {
      setBusy(true);
      setError(null);
      try {
        const r = await resourcesApi.apply(collection, id, { execute: execute !== false });
        await refresh();
        const notes = sanitizeOperatorNotes(r.notes);
        setLastNotes(notes);
        if (r.ok) {
          setMsg(notes[0] ?? '套用完成');
        } else {
          setError(notes[0] ?? '套用未完成');
          setMsg(null);
        }
        return r;
      } catch (e) {
        setError(e instanceof Error ? e.message : '套用失敗');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [collection, refresh],
  );

  return {
    items,
    error,
    setError,
    busy,
    msg,
    setMsg,
    lastNotes,
    refresh,
    create,
    update,
    remove,
    apply,
  };
}
