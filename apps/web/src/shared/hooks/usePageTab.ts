/**
 * Page tab state with optional URL sync (`?tab=`).
 * Prefer for feature pages with ≥3 independent task areas.
 */
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type UsePageTabOptions = {
  /** Sync active tab to `?tab=` (default true) */
  syncUrl?: boolean;
  /** Query key (default `tab`) */
  param?: string;
};

export function usePageTab(
  tabIds: readonly string[],
  defaultId: string,
  options: UsePageTabOptions = {},
): [string, (id: string) => void] {
  const { syncUrl = true, param = 'tab' } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const [local, setLocal] = useState(defaultId);

  const allowed = useMemo(() => new Set(tabIds), [tabIds]);
  const fallback = allowed.has(defaultId) ? defaultId : (tabIds[0] ?? defaultId);

  const fromUrl = searchParams.get(param);
  const active = syncUrl
    ? fromUrl && allowed.has(fromUrl)
      ? fromUrl
      : fallback
    : allowed.has(local)
      ? local
      : fallback;

  const setTab = useCallback(
    (id: string) => {
      if (!allowed.has(id)) return;
      if (!syncUrl) {
        setLocal(id);
        return;
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === fallback) next.delete(param);
          else next.set(param, id);
          return next;
        },
        { replace: true },
      );
    },
    [allowed, fallback, param, setSearchParams, syncUrl],
  );

  return [active, setTab];
}
