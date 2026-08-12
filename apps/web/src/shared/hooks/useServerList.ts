/**
 * Debounced server-backed list fetch with q + dimension filters.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildListQueryString, type ListMeta, type ListSortOrder } from '@yanshekki/shared';
import { api } from '../services/api';

export type UseServerListOptions = {
  /** API path without query, e.g. /api/v1/users */
  path: string;
  /** Debounce for search text only (ms). Filters refetch immediately. */
  debounceMs?: number;
  /** Initial free-text */
  initialQ?: string;
  /** Initial dimension filters */
  initialFilters?: Record<string, string>;
  sort?: string;
  order?: ListSortOrder;
  page?: number;
  limit?: number;
  /** Skip first fetch until enabled */
  enabled?: boolean;
  /** Extra stable query params always sent */
  extraParams?: Record<string, string | undefined>;
};

export type UseServerListResult<T> = {
  items: T[];
  meta: ListMeta | null;
  loading: boolean;
  /** True while debounce pending or fetch in flight after q change */
  searching: boolean;
  error: string | null;
  q: string;
  setQ: (v: string) => void;
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  setFilters: (next: Record<string, string>) => void;
  clear: () => void;
  activeFilterCount: number;
  refresh: () => Promise<void>;
  setError: (e: string | null) => void;
};

type ListPayload<T> = {
  items?: T[];
  meta?: ListMeta;
  /** Some endpoints nest hostUsage etc. — pass through ignored */
  [key: string]: unknown;
};

export function useServerList<T>(opts: UseServerListOptions): UseServerListResult<T> {
  const {
    path,
    debounceMs = 300,
    initialQ = '',
    initialFilters = {},
    sort,
    order,
    page,
    limit,
    enabled = true,
    extraParams,
  } = opts;

  const [items, setItems] = useState<T[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQState] = useState(initialQ);
  const [debouncedQ, setDebouncedQ] = useState(initialQ.trim());
  const [filters, setFiltersState] = useState<Record<string, string>>(() => ({
    ...initialFilters,
  }));

  const seq = useRef(0);
  const filtersKey = useMemo(
    () =>
      Object.keys(filters)
        .sort()
        .map((k) => `${k}=${filters[k]}`)
        .join('&'),
    [filters],
  );
  const extraKey = useMemo(
    () =>
      extraParams
        ? Object.keys(extraParams)
            .sort()
            .map((k) => `${k}=${extraParams[k] ?? ''}`)
            .join('&')
        : '',
    [extraParams],
  );

  // Debounce search text
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQ(q.trim());
    }, debounceMs);
    if (q.trim() !== debouncedQ) setSearching(true);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-debounce on q
  }, [q, debounceMs]);

  const fetchList = useCallback(async () => {
    if (!enabled) return;
    const id = ++seq.current;
    setLoading(true);
    setSearching(true);
    setError(null);
    try {
      const qs = buildListQueryString({
        q: debouncedQ,
        filters,
        sort,
        order,
        page,
        limit,
      });
      let url = path;
      const parts = [qs];
      if (extraParams) {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(extraParams)) {
          if (v != null && v !== '') sp.set(k, v);
        }
        const ex = sp.toString();
        if (ex) parts.push(ex);
      }
      const joined = parts.filter(Boolean).join('&');
      if (joined) url = `${path}?${joined}`;

      const data = await api.requestRaw<ListPayload<T>>(url);
      if (id !== seq.current) return;
      setItems(data.items ?? []);
      setMeta(data.meta ?? null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : 'Load failed');
      setItems([]);
      setMeta(null);
    } finally {
      if (id === seq.current) {
        setLoading(false);
        setSearching(false);
      }
    }
  }, [
    enabled,
    path,
    debouncedQ,
    filters,
    sort,
    order,
    page,
    limit,
    extraParams,
    filtersKey,
    extraKey,
  ]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const setQ = useCallback((v: string) => {
    setQState(v);
  }, []);

  const setFilter = useCallback((key: string, value: string) => {
    setFiltersState((prev) => {
      const next = { ...prev };
      if (!value || value === 'all') delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);

  const setFilters = useCallback((next: Record<string, string>) => {
    setFiltersState({ ...next });
  }, []);

  const clear = useCallback(() => {
    setQState('');
    setDebouncedQ('');
    setFiltersState({});
  }, []);

  const activeFilterCount = useMemo(() => {
    let n = debouncedQ || q.trim() ? 1 : 0;
    n += Object.keys(filters).filter((k) => filters[k]).length;
    // if q typed but not debounced yet, still count
    if (!debouncedQ && q.trim()) n = Math.max(n, 1);
    // avoid double-count: use live q for display
    const live = (q.trim() ? 1 : 0) + Object.keys(filters).filter((k) => filters[k]).length;
    return live;
  }, [q, debouncedQ, filters]);

  return {
    items,
    meta,
    loading,
    searching,
    error,
    q,
    setQ,
    filters,
    setFilter,
    setFilters,
    clear,
    activeFilterCount,
    refresh: fetchList,
    setError,
  };
}
