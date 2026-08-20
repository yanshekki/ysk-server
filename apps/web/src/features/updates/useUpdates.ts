/**
 * Updates feature — inventory + self-update hook (panel apply).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updatesApi, type AdviceRow, type UpdateHubEntry } from './api';
import { api } from '../../shared/services/api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';
import { toast } from '../../shared/stores/toast-store';
import {
  isPanelRestartDisconnect,
  shouldToastUpdateError,
  waitForPanelAfterRestart,
} from './self-apply';
import { useOpsStreamOptional } from '../../shared/ops-stream/OpsStreamContext';

export function useUpdates() {
  const { t } = useTranslation();
  const stream = useOpsStreamOptional();
  const [inventory, setInventory] = useState<AdviceRow[]>([]);
  const [entries, setEntries] = useState<UpdateHubEntry[]>([]);
  const [selfUpdate, setSelfUpdate] = useState<Record<string, unknown> | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [uiReloadVersion, setUiReloadVersion] = useState<string | null>(null);
  const applySelfLock = useRef(false);

  const load = useCallback(async (
    refresh = false,
    osv = false,
    listQuery?: { q?: string; risk?: string; upgradable?: string; approval?: string },
  ) => {
    if (applySelfLock.current) return;
    setError(null);
    if (refresh) setBusy(true);
    try {
      if (refresh) {
        const inv = await updatesApi.refresh(osv);
        setInventory((inv.advice ?? []).slice(0, 500));
        setEntries(inv.entries ?? []);
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
        const hasFilter = Boolean(
          listQuery?.q || listQuery?.risk || listQuery?.upgradable || listQuery?.approval,
        );
        const fromRows = invRows.map((i) => ({
          packageName: String(i.packageName ?? (i as { name?: string }).name ?? ''),
          currentVersion: String(i.currentVersion ?? (i as { version?: string }).version ?? ''),
          candidateVersion: i.candidateVersion as string | undefined,
          advice: 'skip' as const,
          risk: (i.risk as AdviceRow['risk']) ?? 'low',
          cves: [] as string[],
          requiresApproval: Boolean((i as { needsApproval?: boolean }).needsApproval),
          summary: '',
        }));
        const merged = hasFilter
          ? fromRows.length > 0
            ? fromRows
            : (inv.advice ?? [])
          : inv.advice?.length
            ? inv.advice
            : fromRows;
        setInventory(merged.slice(0, 500));
        setEntries(inv.entries ?? []);
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
        const rec = status as Record<string, unknown>;
        // Successful check: drop leftover scoped-package 404s from toast/notes
        if (rec.ok !== false && rec.checked !== false && Array.isArray(rec.notes)) {
          rec.notes = (rec.notes as string[]).filter(
            (n) => !/@ysk\/server|@yanshekki\/server|@ysk-server\//i.test(n),
          );
        }
        setSelfUpdate(rec);
      } catch (e) {
        setSelfUpdate({
          ok: false,
          checked: false,
          updateAvailable: false,
          currentVersion: '—',
          latestVersion: 'unknown',
          notes: [e instanceof Error ? e.message : t('updates.panelCheckFailed')] });
      }
      try {
        const sch = await updatesApi.scheduler();
        setJobs(sch.jobs ?? []);
      } catch {
        /* optional */
      }
    } catch (e) {
      setError(null);
      if (shouldToastUpdateError(e)) {
        toast.error(e instanceof Error ? e.message : t('common.loadFailed'));
      }
    } finally {
      setBusy(false);
    }
  }, [t]);

  /** Force re-scan host apt inventory (invalidates stale cached list after apply). */
  const rescanInventoryQuiet = useCallback(async () => {
    try {
      const inv = await updatesApi.refresh(false);
      // Prefer advice (has risk/approval); fall back to inventory rows
      const advice = (inv.advice ?? []) as AdviceRow[];
      const invRows = inv.inventory ?? [];
      if (advice.length > 0) {
        setInventory(advice.slice(0, 200));
      } else {
        setInventory(
          invRows.slice(0, 200).map((i) => {
            const cur = String(i.currentVersion ?? '');
            const cand = String(i.candidateVersion ?? cur);
            const up = Boolean(cand && cand !== cur);
            return {
              packageName: String(i.packageName ?? ''),
              currentVersion: cur,
              candidateVersion: cand,
              advice: (up ? 'update' : 'skip') as AdviceRow['advice'],
              risk: 'low' as const,
              cves: [] as string[],
              requiresApproval: up,
              summary: '' };
          }),
        );
      }
      setLastAt(inv.collectedAt ?? new Date().toISOString());
      setEntries(inv.entries ?? []);
    } catch {
      /* keep prior list; user can click 掃描套件 */
    }
  }, []);

  const applyPackage = useCallback(async (
    row: AdviceRow,
    confirmHighRisk = false,
    opts?: {
      onLog?: (line: { stream: 'stdout' | 'stderr' | 'status'; line: string }) => void;
    },
  ) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const body = {
        packageName: row.packageName,
        currentVersion: row.currentVersion,
        candidateVersion: row.candidateVersion,
        risk: row.risk,
        cves: row.cves,
        requiresApproval: row.requiresApproval,
        summary: row.summary,
        confirmHighRisk };
      const r = opts?.onLog
        ? await updatesApi.applyPackageStream(body, { onLog: opts.onLog })
        : await updatesApi.applyPackage(body);
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
                  requiresApproval: false }
              : x,
          ),
        );
        await rescanInventoryQuiet();
      }
      return r;
    } catch (e) {
      setError(null);
      if (shouldToastUpdateError(e)) {
        toast.error(e instanceof Error ? e.message : t('updates.updateFailed'));
      }
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
        onLog?: (line: { stream: 'stdout' | 'stderr' | 'status'; line: string }) => void;
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
            const batchBody = {
              packages: rows.map((row) => ({
                packageName: row.packageName,
                currentVersion: row.currentVersion,
                candidateVersion: row.candidateVersion,
                risk: row.risk,
                cves: row.cves,
                requiresApproval: row.requiresApproval,
                summary: row.summary })),
              confirmHighRisk: Boolean(opts?.confirmHighRisk) };
            const batch = opts?.onLog
              ? await updatesApi.applyBatchStream(batchBody, {
                  onLog: opts.onLog,
                  signal: opts.signal })
              : await updatesApi.applyBatch(batchBody);
            for (const r of batch.results ?? []) {
              // Require applied===true — never count plan-only / empty as success
              if (r.ok && r.applied === true) ok.push(r.packageName);
              else {
                fail.push({
                  pkg: r.packageName,
                  message:
                    r.blockMessage ??
                    (r.notes ?? [])[0] ??
                    t('updates.applyIncomplete') });
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
                    requiresApproval: false };
                }),
              );
              await rescanInventoryQuiet();
            }
            if (!opts?.quiet) {
              const msg = t('updates.batchDone', {
                ok: ok.length,
                fail: fail.length });
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
              message: t('updates.batchCancelled', { }) });
            for (let j = i + 1; j < rows.length; j++) {
              fail.push({
                pkg: rows[j]!.packageName,
                message: t('updates.batchCancelled', { }) });
            }
            break;
          }
          const row = rows[i]!;
          opts?.onProgress?.(i + 1, rows.length, row.packageName);
          try {
            const body = {
              packageName: row.packageName,
              currentVersion: row.currentVersion,
              candidateVersion: row.candidateVersion,
              risk: row.risk,
              cves: row.cves,
              requiresApproval: row.requiresApproval,
              summary: row.summary,
              confirmHighRisk: Boolean(opts?.confirmHighRisk) };
            const r = opts?.onLog
              ? await updatesApi.applyPackageStream(body, {
                  onLog: opts.onLog,
                  signal: opts.signal })
              : await updatesApi.applyPackage(body);
            const notes = sanitizeOperatorNotes(r.notes);
            if (r.blocked || !r.ok || r.applied === false) {
              fail.push({
                pkg: row.packageName,
                message: r.blockMessage ?? notes[0] ?? t('updates.applyIncomplete') });
            } else {
              ok.push(row.packageName);
            }
          } catch (e) {
            fail.push({
              pkg: row.packageName,
              message: shouldToastUpdateError(e)
                ? e instanceof Error
                  ? e.message
                  : t('updates.updateFailed')
                : t('updates.updateFailed') });
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
                requiresApproval: false };
            }),
          );
          await rescanInventoryQuiet();
        }
        if (!opts?.quiet) {
          if (ok.length && !fail.length) {
            toast.ok(
              t('updates.batchDone', {
                ok: ok.length,
                fail: 0 }),
            );
          } else if (ok.length || fail.length) {
            toast.error(
              t('updates.batchDone', {
                ok: ok.length,
                fail: fail.length }),
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

  const finishSelfAfterRestart = useCallback(
    async (expectVersion?: string) => {
      toast.ok(t('updates.panelRestarting'));
      const back = await waitForPanelAfterRestart({
        expectVersion,
        probe: async () => {
          // /health is auth-exempt — GET /updates/self during bounce can 401-logout.
          const h = await api.health();
          const ver = String(h.version ?? '').trim();
          return { currentVersion: ver || undefined, ok: true };
        },
      });
      if (back) {
        const ver = String(back.currentVersion ?? expectVersion ?? '').trim();
        setSelfUpdate({
          ok: true,
          checked: true,
          updateAvailable: false,
          currentVersion: ver || '—',
          latestVersion: expectVersion || ver,
          notes: [],
        });
        toast.ok(t('updates.panelRestarted', { version: ver }));
        setUiReloadVersion(ver || expectVersion || '');
        return back;
      }
      if (expectVersion) {
        setSelfUpdate((prev) => ({
          ...(prev ?? {}),
          ok: true,
          checked: true,
          updateAvailable: false,
          currentVersion: expectVersion,
          latestVersion: expectVersion,
        }));
      }
      toast.ok(t('updates.panelRestartWait'));
      setUiReloadVersion(expectVersion || '');
      return null;
    },
    [t],
  );

  const applySelf = useCallback(async () => {
    if (applySelfLock.current) return;
    applySelfLock.current = true;
    setBusy(true);
    setError(null);
    setMsg(null);
    const expectVersion = String(selfUpdate?.latestVersion ?? '').trim() || undefined;
    const job = stream?.begin({
      kind: 'apply',
      title: t('updates.applyPanelUpdate'),
    });
    try {
      const r = await updatesApi.selfApply({
        signal: job?.signal,
        onLog: (line) => {
          if (job) stream?.appendLog(job.id, line);
        },
      });
      if (r.applied || r.restarting) {
        if (job) {
          stream?.appendLog(job.id, {
            stream: 'status',
            line: t('updates.panelRestarting'),
          });
        }
      }
      if (job) {
        stream?.finish(job.id, {
          ok: r.ok !== false && !r.blockMessage,
          error: r.ok === false ? r.blockMessage || r.message : undefined,
        });
      }
      const notes = sanitizeOperatorNotes(r.notes);
      const isProbe = (n: string) => /npm 頻道|頻道：|channel：|GitHub release/i.test(n);
      const isNoticeDump = (n: string) => ((n.match(/npm notice/gi) || []).length >= 2);
      const isLeftover = (n: string) =>
        /leftover|overlay does not|overlayDoesNotHeal|000-default|stale CLI|舊 CLI|殘留|vsftpd is failed|vsftpd 失敗/i.test(
          n,
        );
      const isFail = (n: string) =>
        /失敗|failed|blocked|EXECUTE|權限|無法|error|incomplete|未套用|系統變更|need execute|找不到|未包含|無法寫入|無法下載/i.test(
          n,
        ) &&
        !isNoticeDump(n) &&
        !isLeftover(n);
      const toastNote = (failed: boolean, fallback: string) => {
        const pick = (s?: string) => {
          const v = String(s || '').trim();
          if (!v || isProbe(v) || isNoticeDump(v)) return '';
          return v;
        };
        if (failed && pick(r.blockMessage)) return pick(r.blockMessage);
        if (failed && pick(r.message)) return pick(r.message);
        if (failed) {
          const f = notes.filter(isFail);
          if (f.length) return f[f.length - 1]!;
        }
        const meaningful = notes.filter((n) => !isProbe(n) && !isNoticeDump(n));
        if (meaningful.length) return meaningful[meaningful.length - 1]!;
        if (notes.some(isNoticeDump)) {
          return t('notes.auto.selfUpgradeHint');
        }
        return notes[notes.length - 1] ?? fallback;
      };
      if (r.ok === false || (r.applied === false && r.ok !== true)) {
        setError(null);
        toast.error(toastNote(true, t('updates.updateIncomplete')));
      } else if (r.applied || r.restarting) {
        setMsg(null);
        await finishSelfAfterRestart(expectVersion);
      } else {
        setMsg(null);
        toast.ok(toastNote(false, t('updates.selfUpToDate')));
      }
      return r;
    } catch (e) {
      if (isPanelRestartDisconnect(e)) {
        if (job) {
          stream?.appendLog(job.id, { stream: 'status', line: t('updates.panelRestarting') });
          stream?.finish(job.id, { ok: true });
        }
        await finishSelfAfterRestart(expectVersion);
        return { ok: true, applied: true, restarting: true, notes: [] };
      }
      const raw = e instanceof Error ? e.message : t('updates.updateFailed');
      const m =
        (raw.match(/npm notice/gi) || []).length >= 2 || /Tarball Contents/i.test(raw)
          ? t('notes.auto.selfUpgradeHint')
          : raw;
      if (job) stream?.finish(job.id, { ok: false, error: m });
      setError(null);
      if (shouldToastUpdateError(e)) {
        toast.error(m);
      }
      return { ok: false, applied: false, notes: [m] };
    } finally {
      applySelfLock.current = false;
      setBusy(false);
    }
  }, [t, selfUpdate?.latestVersion, finishSelfAfterRestart, stream]);

  useEffect(() => {
    void load(false);
  }, [load]);

  return {
    inventory,
    entries,
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
    uiReloadVersion,
    dismissUiReload: () => setUiReloadVersion(null),
  };
}
