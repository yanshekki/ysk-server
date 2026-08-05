/**
 * Resource collection CRUD with **server-backed** search (`q` query param).
 * List always hits GET /api/v1/resources/{collection}?q=… (debounced).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ListMeta } from '@ysk/shared';
import { resourcesApi, type ResourceRow } from './api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';
import { toast } from '../../shared/stores/toast-store';

export function useResourceCrud(
  collection: string,
  query?: Record<string, string>,
) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ResourceRow[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastNotes, setLastNotes] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const queryKey = query ? JSON.stringify(query) : '';
  const seq = useRef(0);

  useEffect(() => {
    const tmr = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(tmr);
  }, [q]);

  const refresh = useCallback(async () => {
    const id = ++seq.current;
    setListLoading(true);
    const extra = queryKey ? (JSON.parse(queryKey) as Record<string, string>) : {};
    const params: Record<string, string> = { ...extra };
    if (debouncedQ) params.q = debouncedQ;
    try {
      const r = await resourcesApi.list(collection, params);
      if (id !== seq.current) return r.items;
      setItems(r.items ?? []);
      setMeta((r as { meta?: ListMeta }).meta ?? null);
      return r.items;
    } finally {
      if (id === seq.current) setListLoading(false);
    }
  }, [collection, queryKey, debouncedQ]);

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
        const ok = t('resources.created');
        setMsg(null);
        toast.ok(ok);
        return r.item;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.createFailed');
        setError(null);
        toast.error(m);
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
        const ok = t('resources.updated');
        setMsg(null);
        toast.ok(ok);
        return r.item;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.saveFailed');
        setError(null);
        toast.error(m);
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
        const ok = t('resources.deleted');
        setMsg(null);
        toast.ok(ok);
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.deleteFailed');
        setError(null);
        toast.error(m);
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
        const r = await resourcesApi.apply(collection, id, {
          execute: execute !== false,
        });
        await refresh();
        const notes = sanitizeOperatorNotes(r.notes);
        setLastNotes(notes);
        if (r.ok) {
          const ok = notes[0] ?? t('resources.applyDone');
          setMsg(null);
          toast.ok(ok);
        } else {
          const errText = notes[0] ?? t('resources.applyIncomplete');
          setError(null);
          setMsg(null);
          toast.error(errText);
        }
        return r;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.applyFailed');
        setError(null);
        toast.error(m);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [collection, refresh, t],
  );

  const clearSearch = useCallback(() => {
    setQ('');
    setDebouncedQ('');
  }, []);

  const activeFilterCount = useMemo(() => (q.trim() ? 1 : 0), [q]);
  const total = meta?.total ?? items.length;
  const searching = listLoading && Boolean(debouncedQ || q);

  return {
    items,
    meta,
    total,
    error,
    setError,
    busy,
    listLoading,
    searching,
    msg,
    setMsg,
    lastNotes,
    refresh,
    create,
    update,
    remove,
    apply,
    q,
    setQ,
    clearSearch,
    activeFilterCount,
  };
}
