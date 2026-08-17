/**
 * Page tab state with optional URL sync (`?tab=`).
 * Prefer for feature pages with ≥3 independent task areas.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type UsePageTabOptions = {
  /** Sync active tab to `?tab=` (default true) */
  syncUrl?: boolean;
  /** Query key (default `tab`) */
  param?: string;
  /** Map legacy / bookmarked query values onto a real tab id */
  aliases?: Record<string, string>;
};

const DEFAULT_TAB_ALIASES: Record<string, string> = {
  apikeys: 'keys',
  api: 'keys',
  perms: 'permissions',
  perm: 'permissions',
  plans: 'packages',
  inventory: 'packages',
  shadowsocks: 'outline',
  ss: 'outline',
  truthip: 'realip',
  truth: 'realip',
  help: 'about',
  software: 'stack',
  self: 'panel',
  disk: 'storage',
  dash: 'dashboard',
  torrent: 'torrents',
  admission: 'geo',
  ipacl: 'geo',
  ip: 'geo',
  processes: 'live',
  maintenance: 'ops',
};

function resolveTabId(
  raw: string | null,
  allowed: Set<string>,
  aliases: Record<string, string>,
): string | null {
  if (!raw) return null;
  if (allowed.has(raw)) return raw;
  const mapped = aliases[raw];
  if (mapped && allowed.has(mapped)) return mapped;
  return null;
}

export function usePageTab(
  tabIds: readonly string[],
  defaultId: string,
  options: UsePageTabOptions = {},
): [string, (id: string) => void] {
  const { syncUrl = true, param = 'tab', aliases } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const [local, setLocal] = useState(defaultId);

  const allowed = useMemo(() => new Set(tabIds), [tabIds]);
  const aliasMap = useMemo(
    () => ({ ...DEFAULT_TAB_ALIASES, ...aliases }),
    [aliases],
  );
  const fallback = allowed.has(defaultId) ? defaultId : (tabIds[0] ?? defaultId);

  const rawParam = searchParams.get(param);
  const fromUrl = resolveTabId(rawParam, allowed, aliasMap);
  const active = syncUrl
    ? fromUrl ?? fallback
    : allowed.has(local)
      ? local
      : fallback;

  useEffect(() => {
    if (!syncUrl || !rawParam) return;
    const mapped = aliasMap[rawParam];
    // Keep the operator's tab key (help → about). Only strip unknown keys.
    if (allowed.has(rawParam)) return;
    if (mapped && allowed.has(mapped)) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!fallback || fallback === rawParam) return prev;
        next.delete(param);
        return next;
      },
      { replace: true },
    );
  }, [allowed, aliasMap, fallback, param, rawParam, setSearchParams, syncUrl]);

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
