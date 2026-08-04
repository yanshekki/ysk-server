import { looksLikeBlockedMessage } from '../../shared/lib/operator-messages';
/**
 * Hook: probe + one-click install for a feature's required software.
 * MySQL/MariaDB: exclusive switch dialog when the other engine is installed.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  softwareApi,
  type SoftwareInstallResult,
  type SoftwareStatus,
  type SqlSwitchPreview,
} from './api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

function sqlTargetFromFeature(feature: string): 'mysql' | 'mariadb' | null {
  if (feature === 'mysql') return 'mysql';
  if (feature === 'mariadb') return 'mariadb';
  return null;
}

export function useFeatureSoftware(feature: string) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SoftwareStatus[]>([]);
  const [missing, setMissing] = useState<SoftwareStatus[]>([]);
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SoftwareInstallResult | null>(null);
  const [switchPreview, setSwitchPreview] = useState<SqlSwitchPreview | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);

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

  const beginInstallOrSwitch = useCallback(async () => {
    const target = sqlTargetFromFeature(feature);
    if (target) {
      setBusy(true);
      setError(null);
      setMsg(null);
      try {
        const preview = await softwareApi.sqlEngineSwitchPreview(target);
        if (preview.needsSwitch) {
          setSwitchPreview(preview);
          setSwitchOpen(true);
          setBusy(false);
          return { ok: false, code: 'needs_exclusive_switch' } as SoftwareInstallResult;
        }
      } catch {
        /* fall through to normal install */
      }
      setBusy(false);
    }

    setBusy(true);
    setError(null);
    setMsg(null);
    setLastResult(null);
    try {
      const r = await softwareApi.installFeature(feature);
      // Backend exclusive gate (defense in depth)
      if (r.code === 'needs_exclusive_switch' || r.results?.some((x) => x.code === 'needs_exclusive_switch')) {
        const tTarget =
          r.switchTarget ??
          r.results?.find((x) => x.switchTarget)?.switchTarget ??
          sqlTargetFromFeature(feature);
        if (tTarget) {
          try {
            const preview = await softwareApi.sqlEngineSwitchPreview(tTarget);
            setSwitchPreview(preview);
            setSwitchOpen(true);
          } catch {
            present(r, '');
          }
          return r;
        }
      }
      present(r, t('softwareBanner.allInstalled'));
      await refresh();
      return r;
    } catch (e) {
      const m = e instanceof Error ? e.message : t('common.installFailed');
      const fail: SoftwareInstallResult = {
        ok: false,
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

  const confirmSwitch = useCallback(async () => {
    const target = switchPreview?.target ?? sqlTargetFromFeature(feature);
    if (!target || !switchPreview) return { ok: false } as SoftwareInstallResult;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await softwareApi.sqlEngineSwitch({
        target,
        confirmPhrase: switchPreview.confirmPhrase || 'SWITCH',
        acknowledgeExclusive: true,
        migrateData: true,
      });
      setSwitchOpen(false);
      present(
        {
          ok: r.ok,
          notes: r.notes,
          blocked: r.blocked,
          blockMessage: r.blockMessage,
          steps: r.steps,
          code: r.code,
        },
        t('sqlEngineSwitch.success'),
      );
      await refresh();
      return r;
    } catch (e) {
      const m = e instanceof Error ? e.message : t('common.installFailed');
      const fail: SoftwareInstallResult = {
        ok: false,
        blocked: looksLikeBlockedMessage(m),
        blockMessage: m,
        notes: [m],
      };
      present(fail, '');
      return fail;
    } finally {
      setBusy(false);
    }
  }, [feature, present, refresh, switchPreview, t]);

  const installOne = useCallback(
    async (id: string) => {
      if (id === 'mysql-server' || id === 'mariadb-server') {
        return beginInstallOrSwitch();
      }
      setBusy(true);
      setError(null);
      setMsg(null);
      setLastResult(null);
      try {
        const r = await softwareApi.installOne(id);
        if (r.code === 'needs_exclusive_switch' && r.switchTarget) {
          const preview = await softwareApi.sqlEngineSwitchPreview(r.switchTarget);
          setSwitchPreview(preview);
          setSwitchOpen(true);
          return r;
        }
        present(r, t('softwareBanner.installedOne', { name: r.title ?? id }));
        await refresh();
        return r;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.installFailed');
        const fail: SoftwareInstallResult = {
          ok: false,
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
    [beginInstallOrSwitch, present, refresh, t],
  );

  const installAll = beginInstallOrSwitch;

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
    switchPreview,
    switchOpen,
    setSwitchOpen,
    confirmSwitch,
  };
}
