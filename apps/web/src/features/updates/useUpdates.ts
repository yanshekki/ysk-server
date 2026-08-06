/**
 * Updates feature — inventory + self-update hook (panel apply).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updatesApi, type AdviceRow } from './api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';
import { toast } from '../../shared/stores/toast-store';

export function useUpdates() {
  const { t } = useTranslation();
  const [inventory, setInventory] = useState<AdviceRow[]>([]);
  const [selfUpdate, setSelfUpdate] = useState<Record<string, unknown> | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (
    refresh = false,
    osv = false,
    listQuery?: { q?: string; risk?: string; upgradable?: string; approval?: string },
  ) => {
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
        const scanMsg = [
          osv
            ? t('updates.scannedWithOsv', { count: inv.inventory?.length ?? 0 })
            : t('updates.scanned', { count: inv.inventory?.length ?? 0 }),
          t('updates.realUpgradeable', { count: up }),
          ...(notes ?? []).slice(0, 2),
        ]
          .filter(Boolean)
          .join(' · ');
        setMsg(null);
        toast.ok(scanMsg);
      } else {
        const inv = await updatesApi.inventory(listQuery);
        // Prefer filtered inventory rows (backend ListQuery) when present
        const listMeta = (inv as { listMeta?: { total?: number } }).listMeta;
        const invRows = inv.inventory ?? [];
        const merged =
          inv.advice?.length > 0 && !listQuery?.q && !listQuery?.risk && !listQuery?.upgradable && !listQuery?.approval
            ? inv.advice
            : invRows.length > 0
              ? invRows.map((i) => ({
                  packageName: String(i.packageName ?? (i as { name?: string }).name ?? ''),
                  currentVersion: String(i.currentVersion ?? (i as { version?: string }).version ?? ''),
                  candidateVersion: i.candidateVersion as string | undefined,
                  advice: 'skip' as const,
                  risk: (i.risk as AdviceRow['risk']) ?? 'low',
                  cves: [] as string[],
                  requiresApproval: Boolean((i as { needsApproval?: boolean }).needsApproval),
                  summary: '',
                }))
              : (inv.advice ?? []);
        setInventory(merged.slice(0, 200));
        setLastAt(inv.collectedAt ?? null);
        void listMeta;
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
        setJobs(sch.jobs ?? []);
      } catch {
        /* optional */
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : t('common.loadFailed');
      setError(null);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }, [t]);

  /** Force re-scan host apt inventory (invalidates stale cached list after apply). */
  const rescanInventoryQuiet = useCallback(async () => {
    try {
      const inv = await updatesApi.refresh(false);
      setInventory((inv.advice ?? inv.inventory ?? []).slice(0, 200).map((a) => {
        // normalize inventory-only rows if advice empty
        if ('packageName' in a && 'advice' in a) return a as AdviceRow;
        const i = a as {
          packageName?: string;
          currentVersion?: string;
          candidateVersion?: string;
        };
        return {
          packageName: String(i.packageName ?? ''),
          currentVersion: String(i.currentVersion ?? ''),
          candidateVersion: i.candidateVersion,
          advice: 'skip' as const,
          risk: 'low' as const,
          cves: [] as string[],
          requiresApproval: false,
          summary: '',
        };
      }));
      setLastAt(inv.collectedAt ?? new Date().toISOString());
    } catch {
      /* keep prior list; user can click 掃描套件 */
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
      if (r.blocked || !r.ok || r.applied === false) {
        setError(null);
        toast.error(r.blockMessage ?? notes[0] ?? t('updates.applyIncomplete'));
      } else {
        setMsg(null);
        toast.ok(notes[0] ?? t('updates.appliedPackage'));
        // Optimistic: stop showing as upgradable immediately
        setInventory((prev) =>
          prev.map((x) =>
            x.packageName === row.packageName
              ? {
                  ...x,
                  currentVersion: row.candidateVersion ?? x.currentVersion,
                  candidateVersion: row.candidateVersion ?? x.candidateVersion,
                  advice: 'skip',
                  requiresApproval: false,
                }
              : x,
          ),
        );
        await rescanInventoryQuiet();
      }
      return r;
    } catch (e) {
      const m = e instanceof Error ? e.message : t('updates.updateFailed');
      setError(null);
      toast.error(m);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [t, rescanInventoryQuiet]);

  /**
   * Multi-package apply (no silent full-system apt upgrade).
   * Prefer server apply-batch when N>1; fall back to sequential single apply.
   * onProgress for UI; signal?.aborted stops sequential path between packages.
   */
  const applyPackages = useCallback(
    async (
      rows: AdviceRow[],
      opts?: {
        confirmHighRisk?: boolean;
        onProgress?: (n: number, total: number, pkg: string) => void;
        quiet?: boolean;
        signal?: AbortSignal;
      },
    ): Promise<{ ok: string[]; fail: Array<{ pkg: string; message: string }> }> => {
      const ok: string[] = [];
      const fail: Array<{ pkg: string; message: string }> = [];
      if (!rows.length) return { ok, fail };
      setBusy(true);
      setError(null);
      try {
        // Prefer one server round-trip for bulk
        if (rows.length > 1 && !opts?.signal?.aborted) {
          opts?.onProgress?.(0, rows.length, rows[0]!.packageName);
          try {
            const batch = await updatesApi.applyBatch({
              packages: rows.map((row) => ({
                packageName: row.packageName,
                currentVersion: row.currentVersion,
                candidateVersion: row.candidateVersion,
                risk: row.risk,
                cves: row.cves,
                requiresApproval: row.requiresApproval,
                summary: row.summary,
              })),
              confirmHighRisk: Boolean(opts?.confirmHighRisk),
            });
            for (const r of batch.results ?? []) {
              // Require applied===true — never count plan-only / empty as success
              if (r.ok && r.applied === true) ok.push(r.packageName);
              else {
                fail.push({
                  pkg: r.packageName,
                  message:
                    r.blockMessage ??
                    (r.notes ?? [])[0] ??
                    t('updates.applyIncomplete'),
                });
              }
            }
            opts?.onProgress?.(rows.length, rows.length, rows[rows.length - 1]!.packageName);
            // Optimistic UI + force host rescan so list cannot show same upgrades again
            if (ok.length) {
              const okSet = new Set(ok);
              setInventory((prev) =>
                prev.map((x) => {
                  if (!okSet.has(x.packageName)) return x;
                  const cand = x.candidateVersion ?? x.currentVersion;
                  return {
                    ...x,
                    currentVersion: cand,
                    candidateVersion: cand,
                    advice: 'skip',
                    requiresApproval: false,
                  };
                }),
              );
              await rescanInventoryQuiet();
            }
            if (!opts?.quiet) {
              const msg = t('updates.batchDone', {
                ok: ok.length,
                fail: fail.length,
                defaultValue: `批量完成：成功 ${ok.length}，失敗 ${fail.length}`,
              });
              if (fail.length) toast.error(msg);
              else toast.ok(msg);
            }
            return { ok, fail };
          } catch {
            // fall through to sequential
          }
        }

        for (let i = 0; i < rows.length; i++) {
          if (opts?.signal?.aborted) {
            fail.push({
              pkg: rows[i]!.packageName,
              message: t('updates.batchCancelled', {
                defaultValue: '已取消（其餘未執行）',
              }),
            });
            for (let j = i + 1; j < rows.length; j++) {
              fail.push({
                pkg: rows[j]!.packageName,
                message: t('updates.batchCancelled', {
                  defaultValue: '已取消（其餘未執行）',
                }),
              });
            }
            break;
          }
          const row = rows[i]!;
          opts?.onProgress?.(i + 1, rows.length, row.packageName);
          try {
            const r = await updatesApi.applyPackage({
              packageName: row.packageName,
              currentVersion: row.currentVersion,
              candidateVersion: row.candidateVersion,
              risk: row.risk,
              cves: row.cves,
              requiresApproval: row.requiresApproval,
              summary: row.summary,
              confirmHighRisk: Boolean(opts?.confirmHighRisk),
            });
            const notes = sanitizeOperatorNotes(r.notes);
            if (r.blocked || !r.ok || r.applied === false) {
              fail.push({
                pkg: row.packageName,
                message: r.blockMessage ?? notes[0] ?? t('updates.applyIncomplete'),
              });
            } else {
              ok.push(row.packageName);
            }
          } catch (e) {
            fail.push({
              pkg: row.packageName,
              message: e instanceof Error ? e.message : t('updates.updateFailed'),
            });
          }
        }
        if (ok.length) {
          const okSet = new Set(ok);
          setInventory((prev) =>
            prev.map((x) => {
              if (!okSet.has(x.packageName)) return x;
              const cand = x.candidateVersion ?? x.currentVersion;
              return {
                ...x,
                currentVersion: cand,
                candidateVersion: cand,
                advice: 'skip',
                requiresApproval: false,
              };
            }),
          );
          await rescanInventoryQuiet();
        }
        if (!opts?.quiet) {
          if (ok.length && !fail.length) {
            toast.ok(
              t('updates.batchDone', {
                ok: ok.length,
                fail: 0,
                defaultValue: `批量完成：成功 ${ok.length}，失敗 0`,
              }),
            );
          } else if (ok.length || fail.length) {
            toast.error(
              t('updates.batchDone', {
                ok: ok.length,
                fail: fail.length,
                defaultValue: `批量完成：成功 ${ok.length}，失敗 ${fail.length}`,
              }),
            );
          }
        }
        return { ok, fail };
      } finally {
        setBusy(false);
      }
    },
    [t, rescanInventoryQuiet],
  );

  const applySelf = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await updatesApi.selfApply();
      const notes = sanitizeOperatorNotes(r.notes);
      if (r.ok === false || (r.applied === false && r.ok !== true)) {
        setError(null);
        toast.error(notes[0] ?? t('updates.updateIncomplete'));
      } else if (r.applied) {
        setMsg(null);
        toast.ok(notes[0] ?? t('updates.appliedUpdate'));
      } else {
        setMsg(null);
        toast.ok(notes[0] ?? t('updates.selfUpToDate'));
      }
      try {
        const self = await updatesApi.self();
        setSelfUpdate(self);
      } catch {
        /* keep prior */
      }
      return r;
    } catch (e) {
      const m = e instanceof Error ? e.message : t('updates.updateFailed');
      setError(null);
      toast.error(m);
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
    applyPackages,
  };
}
