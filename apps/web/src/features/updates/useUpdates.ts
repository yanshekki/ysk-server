/**
 * Updates feature — inventory + self-update hook (panel apply).
 */
import { useCallback, useEffect, useState } from 'react';
import { updatesApi, type AdviceRow } from './api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

export function useUpdates() {
  const [inventory, setInventory] = useState<AdviceRow[]>([]);
  const [selfUpdate, setSelfUpdate] = useState<Record<string, unknown> | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (refresh = false, osv = false) => {
    setError(null);
    setBusy(true);
    try {
      if (refresh) {
        const inv = await updatesApi.refresh(osv);
        setInventory(inv.advice.slice(0, 40));
        setLastAt(inv.collectedAt ?? new Date().toISOString());
        setMsg(
          osv
            ? `已掃描 ${inv.inventory.length} 套件（含 OSV 查詢前 12 項）`
            : `已掃描 ${inv.inventory.length} 個套件`,
        );
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
      setError(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setBusy(false);
    }
  }, []);

  const applyPackage = useCallback(async (row: AdviceRow, confirmHighRisk = false) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await updatesApi.applyPackage({
        packageName: row.packageName,
        currentVersion: row.currentVersion,
        candidateVersion: row.candidateVersion,
        risk: row.risk,
        cves: row.cves,
        requiresApproval: row.requiresApproval,
        summary: row.summary,
        confirmHighRisk,
      });
      const notes = sanitizeOperatorNotes(r.notes);
      if (r.blocked || !r.ok) {
        setError(r.blockMessage ?? notes[0] ?? '套用未完成');
      } else {
        setMsg(notes[0] ?? '已套用套件更新');
      }
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失敗');
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const applySelf = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await updatesApi.selfApply();
      const notes = sanitizeOperatorNotes(r.notes);
      if (r.ok === false || (r.applied === false && notes.length)) {
        setError(notes[0] ?? '更新未完成');
      } else {
        setMsg(notes[0] ?? (r.applied ? '已套用更新' : '已是最新版本'));
      }
      const self = await updatesApi.self();
      setSelfUpdate(self);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失敗');
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return {
    inventory,
    selfUpdate,
    lastAt,
    jobs,
    error,
    busy,
    msg,
    setMsg,
    load,
    applySelf,
    applyPackage,
  };
}
