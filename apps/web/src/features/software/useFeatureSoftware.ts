import { looksLikeBlockedMessage } from '../../shared/lib/operator-messages';
/**
 * Hook: probe + one-click install for a feature's required software.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { softwareApi, type SoftwareInstallResult, type SoftwareStatus } from './api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

export function useFeatureSoftware(feature: string) {
  const { t } = useTranslation();
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
      setError(e instanceof Error ? e.message : t('softwareBanner.probeFailed'));
      throw e;
    }
  }, [feature, t]);

  useEffect(() => {
    void refresh().catch(() => {
      /* error state set */
    });
  }, [refresh]);

  const present = useCallback(
    (r: SoftwareInstallResult, okLabel: string) => {
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
        setError(blockMessage ?? notes[0] ?? t('softwareBanner.installIncomplete'));
        setMsg(null);
      } else {
        setError(null);
        setMsg(notes[0] ?? okLabel);
      }
    },
    [t],
  );

  const installOne = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      setMsg(null);
      setLastResult(null);
      try {
        const r = await softwareApi.installOne(id);
        present(r, t('softwareBanner.installedOne', { name: r.title ?? id }));
        await refresh();
        return r;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.installFailed');
        const fail: SoftwareInstallResult = {
          ok: false,
          // L3: match backend Chinese / mixed permission notes until error codes exist
          blocked: looksLikeBlockedMessage(m),
          blockMessage: m,
          notes: [m],
        };
        present(fail, '');
        return fail;
      } finally {
        setBusy(false);
      }
    },
    [present, refresh, t],
  );

  const installAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    setLastResult(null);
    try {
      const r = await softwareApi.installFeature(feature);
      present(r, t('softwareBanner.allInstalled'));
      await refresh();
      return r;
    } catch (e) {
      const m = e instanceof Error ? e.message : t('common.installFailed');
      const fail: SoftwareInstallResult = {
        ok: false,
        // L3: match backend Chinese / mixed permission notes until error codes exist
        blocked: looksLikeBlockedMessage(m),
        blockMessage: m,
        notes: [m],
      };
      present(fail, '');
      return fail;
    } finally {
      setBusy(false);
    }
  }, [feature, present, refresh, t]);

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
