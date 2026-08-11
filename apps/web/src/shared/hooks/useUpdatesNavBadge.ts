/**
 * Single nav badge for /updates — reads cached server summary (no apt).
 */
import { useCallback, useEffect, useState } from 'react';
import { updatesApi } from '../../features/updates';

export type UpdatesNavBadge = {
  count: number;
  stale: boolean;
  refresh: () => Promise<void>;
};

export function useUpdatesNavBadge(): UpdatesNavBadge {
  const [count, setCount] = useState(0);
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await updatesApi.summary().catch(() => null);
      if (!s) return;
      const n = Number(s.badgeCount ?? 0);
      setCount(Number.isFinite(n) && n > 0 ? n : 0);
      setStale(Boolean(s.stale));
    } catch {
      /* keep last known */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { count, stale, refresh };
}
