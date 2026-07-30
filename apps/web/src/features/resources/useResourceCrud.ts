import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resourcesApi, type ResourceRow } from './api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

export function useResourceCrud(collection: string, query?: Record<string, string>) {
  const { t } = useTranslation();
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
        setMsg(t('resources.created'));
        return r.item;
      } catch (e) {
        setError(e instanceof Error ? e.message : t('common.createFailed'));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [collection, refresh, t],
  );

  const update = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await resourcesApi.update(collection, id, body);
        await refresh();
        setMsg(t('resources.updated'));
        return r.item;
      } catch (e) {
        setError(e instanceof Error ? e.message : t('common.saveFailed'));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [collection, refresh, t],
  );

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        await resourcesApi.remove(collection, id);
        await refresh();
        setMsg(t('resources.deleted'));
      } catch (e) {
        setError(e instanceof Error ? e.message : t('common.deleteFailed'));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [collection, refresh, t],
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
          setMsg(notes[0] ?? t('resources.applyDone'));
        } else {
          setError(notes[0] ?? t('resources.applyIncomplete'));
          setMsg(null);
        }
        return r;
      } catch (e) {
        setError(e instanceof Error ? e.message : t('common.applyFailed'));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [collection, refresh, t],
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
