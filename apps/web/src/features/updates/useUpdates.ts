/**
 * Updates feature — inventory + self-update hook.
 */
import { useCallback, useEffect, useState } from 'react';
import { updatesApi, type AdviceRow } from './api';

export function useUpdates() {
  const [inventory, setInventory] = useState<AdviceRow[]>([]);
  const [selfUpdate, setSelfUpdate] = useState<Record<string, unknown> | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setError(null);
    setBusy(true);
    try {
      if (refresh) {
        const inv = await updatesApi.refresh(false);
        setInventory(inv.advice.slice(0, 40));
        setLastAt(inv.collectedAt ?? new Date().toISOString());
        setMsg(`Refreshed ${inv.inventory.length} packages`);
      } else {
        const inv = await updatesApi.inventory();
        const merged =
          inv.advice?.length > 0
            ? inv.advice
            : (inv.inventory ?? []).map((i) => ({
                packageName: i.packageName,
                currentVersion: i.currentVersion,
              }));
        setInventory(merged.slice(0, 40));
        setLastAt(inv.collectedAt ?? null);
      }
      const self = await updatesApi.self();
      setSelfUpdate(self);
      try {
        const sch = await updatesApi.scheduler();
        setJobs(sch.jobs);
      } catch {
        /* optional */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return { inventory, selfUpdate, lastAt, jobs, error, busy, msg, setMsg, load };
}
