/**
 * Single nav badge for /updates — reads cached server summary (no apt).
 */
import { useCallback, useEffect, useState } from 'react';
import { updatesApi } from '../../features/updates';

export type UpdatesNavBadge = {
  count: number;
  stale: boolean;
  panelUpdateAvailable: boolean;
  panelLatest?: string;
  panelCurrent?: string;
  refresh: () => Promise<void>;
};

export function useUpdatesNavBadge(): UpdatesNavBadge {
  const [count, setCount] = useState(0);
  const [stale, setStale] = useState(false);
  const [panelUpdateAvailable, setPanelUpdateAvailable] = useState(false);
  const [panelLatest, setPanelLatest] = useState<string | undefined>(undefined);
  const [panelCurrent, setPanelCurrent] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const s = await updatesApi.summary().catch(() => null);
      if (!s) return;
      const latest = String(s.panelLatest ?? '').trim();
      const current = String(s.panelCurrent ?? '').trim();
      const sameVersion = Boolean(latest && current && latest === current);
      const available = Boolean(s.panelUpdateAvailable) && !sameVersion;
      const n = Number(s.badgeCount ?? 0);
      setCount(Number.isFinite(n) && n > 0 ? (sameVersion ? Math.max(0, n - 1) : n) : 0);
      setStale(Boolean(s.stale));
      setPanelUpdateAvailable(available);
      setPanelLatest(latest || undefined);
      setPanelCurrent(current || undefined);
    } catch {
      /* keep last known */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { count, stale, panelUpdateAvailable, panelLatest, panelCurrent, refresh };
}
