/**
 * Hook: probe + one-click install for a feature's required software.
 */
import { useCallback, useEffect, useState } from 'react';
import { softwareApi, type SoftwareInstallResult, type SoftwareStatus } from './api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

export function useFeatureSoftware(feature: string) {
  const [items, setItems] = useState<SoftwareStatus[]>([]);
  const [missing, setMissing] = useState<SoftwareStatus[]>([]);
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SoftwareInstallResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await softwareApi.list(feature);
      setItems(r.items);
      setMissing(r.missing);
      setReady(r.ready);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : '探測失敗');
      throw e;
    }
  }, [feature]);

  useEffect(() => {
    void refresh().catch(() => {
      /* error state set */
    });
  }, [refresh]);

  const present = useCallback((r: SoftwareInstallResult, okLabel: string) => {
    const notes = sanitizeOperatorNotes([
      ...(r.blockMessage ? [r.blockMessage] : []),
      ...(r.notes ?? []),
      ...(r.results?.flatMap((x) => [
        ...(x.blockMessage ? [x.blockMessage] : []),
        ...(x.notes ?? []),
      ]) ?? []),
    ]);
    const blocked = Boolean(r.blocked || r.results?.some((x) => x.blocked));
    const blockMessage =
      r.blockMessage ??
      r.results?.find((x) => x.blockMessage)?.blockMessage ??
      (blocked ? notes[0] : undefined);
    setLastResult({
      ...r,
      blocked,
      blockMessage,
      notes,
    });
    if (blocked || r.ok === false) {
      setError(blockMessage ?? notes[0] ?? '安裝未完成');
      setMsg(null);
    } else {
      setError(null);
      setMsg(notes[0] ?? okLabel);
    }
  }, []);

  const installOne = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      setMsg(null);
      setLastResult(null);
      try {
        const r = await softwareApi.installOne(id);
        present(r, `已安裝 ${r.title ?? id}`);
        await refresh();
        return r;
      } catch (e) {
        const m = e instanceof Error ? e.message : '安裝失敗';
        const fail: SoftwareInstallResult = {
          ok: false,
          blocked: /權限|系統變更|管理員/.test(m),
          blockMessage: m,
          notes: [m],
        };
        present(fail, '');
        return fail;
      } finally {
        setBusy(false);
      }
    },
    [present, refresh],
  );

  const installAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    setLastResult(null);
    try {
      const r = await softwareApi.installFeature(feature);
      present(r, '所需軟件已安裝');
      await refresh();
      return r;
    } catch (e) {
      const m = e instanceof Error ? e.message : '安裝失敗';
      const fail: SoftwareInstallResult = {
        ok: false,
        blocked: /權限|系統變更|管理員/.test(m),
        blockMessage: m,
        notes: [m],
      };
      present(fail, '');
      return fail;
    } finally {
      setBusy(false);
    }
  }, [feature, present, refresh]);

  return {
    items,
    missing,
    ready,
    busy,
    error,
    msg,
    setMsg,
    setError,
    lastResult,
    refresh,
    installOne,
    installAll,
  };
}
