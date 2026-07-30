/**
 * Updates feature — inventory + self-update hook (panel apply).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updatesApi, type AdviceRow } from './api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

export function useUpdates() {
  const { t } = useTranslation();
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
        setInventory((inv.advice ?? []).slice(0, 120));
        setLastAt(inv.collectedAt ?? new Date().toISOString());
        const up = (inv.advice ?? []).filter(
          (a) => a.candidateVersion && a.candidateVersion !== a.currentVersion,
        ).length;
        const notes = (inv as { meta?: { notes?: string[] } }).meta?.notes;
        setMsg(
          [
            osv
              ? t('updates.scannedWithOsv', { count: inv.inventory?.length ?? 0 })
              : t('updates.scanned', { count: inv.inventory?.length ?? 0 }),
            t('updates.realUpgradeable', { count: up }),
            ...(notes ?? []).slice(0, 2),
          ]
            .filter(Boolean)
            .join(' · '),
        );
      } else {
        const inv = await updatesApi.inventory();
        const merged =
          inv.advice?.length > 0
            ? inv.advice
            : (inv.inventory ?? []).map((i) => ({
                packageName: i.packageName,
                currentVersion: i.currentVersion,
                // never invent candidateVersion = current (fake upgrade signal)
                candidateVersion: i.candidateVersion,
                advice: 'skip' as const,
                risk: 'low' as const,
                cves: [] as string[],
                requiresApproval: false,
                summary: '',
              }));
        setInventory(merged.slice(0, 120));
        setLastAt(inv.collectedAt ?? null);
      }
      try {
        const self = await updatesApi.self();
        // Prefer flat status; tolerate nested plan.status from older API
        const status =
          self && typeof self === 'object' && 'status' in self && self.status
            ? { ...(self as Record<string, unknown>), ...(self.status as object) }
            : self;
        setSelfUpdate(status as Record<string, unknown>);
      } catch (e) {
        setSelfUpdate({
          ok: false,
          checked: false,
          updateAvailable: false,
          currentVersion: '—',
          latestVersion: 'unknown',
          notes: [e instanceof Error ? e.message : t('updates.panelCheckFailed')],
        });
      }
      try {
        const sch = await updatesApi.scheduler();
        setJobs(sch.jobs);
      } catch {
        /* optional */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [t]);

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
        setError(r.blockMessage ?? notes[0] ?? t('updates.applyIncomplete'));
      } else {
        setMsg(notes[0] ?? t('updates.appliedPackage'));
      }
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('updates.updateFailed'));
      throw e;
    } finally {
      setBusy(false);
    }
  }, [t]);

  const applySelf = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await updatesApi.selfApply();
      const notes = sanitizeOperatorNotes(r.notes);
      if (r.ok === false || (r.applied === false && r.ok !== true)) {
        setError(notes[0] ?? t('updates.updateIncomplete'));
      } else if (r.applied) {
        setMsg(notes[0] ?? t('updates.appliedUpdate'));
      } else {
        setMsg(notes[0] ?? t('updates.selfUpToDate'));
      }
      try {
        const self = await updatesApi.self();
        setSelfUpdate(self);
      } catch {
        /* keep prior */
      }
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('updates.updateFailed'));
      throw e;
    } finally {
      setBusy(false);
    }
  }, [t]);

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
