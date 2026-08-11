/**
 * Feature software lifecycle: one-click install + uninstall with stream dock.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClassName } from './Button';
import { useFeatureSoftware } from '../../../features/software';
import { softwareApi } from '../../../features/software/api';
import { OpsResultPanel, type OpsResultLike } from './OpsResultPanel';
import { SqlEngineSwitchDialog } from './SqlEngineSwitchDialog';
import { SoftwareUninstallDialog } from './SoftwareUninstallDialog';
import {
  isAbortError,
  useOpsStreamOptional,
} from '../../ops-stream/OpsStreamContext';
import { toast } from '../../stores/toast-store';

export interface SoftwareInstallBannerProps {
  feature: string;
  onInstalled?: () => void;
  autoHideWhenReady?: boolean;
  /** Title when software is missing / not ready */
  title?: string;
  /** Title when ready strip is shown (defaults to softwareLifecycle.readyTitle) */
  readyTitle?: string;
  /** Uninstall dialog title (defaults to title / readyTitle — not the "not installed" copy) */
  uninstallTitle?: string;
  /**
   * When false and software is ready, hide the ready strip entirely
   * (use when SoftwareVersionBar below already has uninstall / recheck).
   * Default true keeps lifecycle ready actions when banner is standalone.
   */
  showReadyActions?: boolean;
  compact?: boolean;
}

export function SoftwareInstallBanner({
  feature,
  onInstalled,
  autoHideWhenReady = true,
  title,
  readyTitle,
  uninstallTitle,
  showReadyActions = true,
}: SoftwareInstallBannerProps) {
  const { t } = useTranslation();
  const stream = useOpsStreamOptional();
  const {
    items,
    missing,
    ready,
    busy,
    error,
    setMsg,
    setError,
    lastResult,
    refresh,
    installAll,
    switchPreview,
    switchOpen,
    setSwitchOpen,
    confirmSwitch,
    setBusy,
  } = useFeatureSoftware(feature);

  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [uninstallBusy, setUninstallBusy] = useState(false);

  const missingList = Array.isArray(missing) ? missing : [];
  const installedAny = (items ?? []).some((i) => i.installed);
  const names = missingList.map((m) => m.title).join(t('softwareBanner.nameSep'));

  const opsResult: OpsResultLike | null = lastResult
    ? {
        ok: Boolean(lastResult.ok),
        notes: lastResult.notes,
        blocked: lastResult.blocked,
        blockMessage: lastResult.blockMessage,
        requiresExecute: lastResult.blocked,
      }
    : error
      ? { ok: false, blocked: true, blockMessage: error, notes: [] }
      : null;

  const runInstall = async () => {
    if (stream?.isBusy) {
      toast.error(t('softwareLifecycle.jobInProgress'));
      return;
    }
    const label = title ?? t('softwareBanner.titleDefault');
    if (stream) {
      const { id: jobId, signal } = stream.begin({
        kind: 'install',
        title: label,
      });
      setBusy(true);
      try {
        const { ops } = await softwareApi.installFeatureStream(feature, {
          onLog: (line) => stream.appendLog(jobId, line),
          signal,
        });
        if (signal.aborted) {
          stream.finish(jobId, {
            ok: false,
            cancelled: true,
            error: t('softwareLifecycle.cancelHint'),
          });
          toast.error(t('softwareLifecycle.cancelledToast'));
          await refresh();
        } else {
          stream.finish(jobId, {
            ok: ops.ok !== false && !ops.blocked,
            error: ops.blockMessage,
          });
          if (ops.ok && !ops.blocked) {
            toast.ok(
              ops.notes?.[0] ??
                t('softwareBanner.installOk', { defaultValue: 'Installed' }),
            );
            onInstalled?.();
            await refresh();
          } else {
            setError(
              ops.blockMessage ||
                ops.notes?.[0] ||
                t('softwareBanner.installIncomplete'),
            );
          }
        }
      } catch (e) {
        if (isAbortError(e) || signal.aborted) {
          stream.finish(jobId, {
            ok: false,
            cancelled: true,
            error: t('softwareLifecycle.cancelHint'),
          });
          toast.error(t('softwareLifecycle.cancelledToast'));
          await refresh();
        } else {
          const msg = e instanceof Error ? e.message : t('common.opFailed');
          stream.finish(jobId, { ok: false, error: msg });
          setError(msg);
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    const r = await installAll();
    if (r.ok) onInstalled?.();
  };

  const runUninstall = async (opts: {
    dataPolicy: 'keep' | 'purge';
    confirmPhrase: string;
  }) => {
    if (stream?.isBusy) {
      toast.error(t('softwareLifecycle.jobInProgress'));
      return;
    }
    const label = title ?? feature;
    const started = stream
      ? stream.begin({ kind: 'uninstall', title: label })
      : null;
    const jobId = started?.id ?? '';
    const signal = started?.signal;
    setUninstallBusy(true);
    try {
      const { ops } = await softwareApi.uninstallStream(
        {
          feature,
          dataPolicy: opts.dataPolicy,
          confirmPhrase: opts.confirmPhrase,
        },
        {
          onLog: (line) => {
            if (jobId && stream) stream.appendLog(jobId, line);
          },
          signal,
        },
      );
      if (stream && jobId) {
        if (signal?.aborted) {
          stream.finish(jobId, {
            ok: false,
            cancelled: true,
            error: t('softwareLifecycle.cancelHint'),
          });
          toast.error(t('softwareLifecycle.cancelledToast'));
        } else {
          stream.finish(jobId, {
            ok: ops.ok !== false && !ops.blocked,
            error: ops.blockMessage,
          });
        }
      }
      if (signal?.aborted) {
        setUninstallOpen(false);
        await refresh();
      } else if (ops.ok && !ops.blocked) {
        toast.ok(ops.notes?.[0] ?? t('softwareLifecycle.uninstallDone'));
        setUninstallOpen(false);
        await refresh();
      } else {
        toast.error(
          ops.blockMessage ||
            ops.notes?.[0] ||
            t('softwareLifecycle.uninstallFailed'),
        );
      }
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) {
        if (stream && jobId) {
          stream.finish(jobId, {
            ok: false,
            cancelled: true,
            error: t('softwareLifecycle.cancelHint'),
          });
        }
        toast.error(t('softwareLifecycle.cancelledToast'));
        setUninstallOpen(false);
        await refresh();
      } else {
        const msg = e instanceof Error ? e.message : t('common.opFailed');
        if (stream && jobId) stream.finish(jobId, { ok: false, error: msg });
        toast.error(msg);
      }
    } finally {
      setUninstallBusy(false);
    }
  };

  // Ready: either hide (VersionBar owns actions) or compact uninstall strip
  if (autoHideWhenReady && ready && !error && !lastResult && !switchOpen) {
    if (!installedAny || !showReadyActions) return null;
    return (
      <div className="software-install-banner software-install-banner--ready">
        <div className="software-install-banner__alert" role="status">
          <div className="software-install-banner__row">
            <div className="software-install-banner__text">
              <h3 className="software-install-banner__title">
                {readyTitle ?? t('softwareLifecycle.readyTitle')}
              </h3>
              <p className="software-install-banner__desc muted">
                {t('softwareLifecycle.readyHint')}
              </p>
            </div>
            <div className="software-install-banner__actions">
              <button
                type="button"
                className={buttonClassName({ variant: 'danger', size: 'sm' })}
                disabled={busy || uninstallBusy || stream?.isBusy}
                onClick={() => setUninstallOpen(true)}
              >
                {t('softwareLifecycle.uninstall')}
              </button>
              <button
                type="button"
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                disabled={busy}
                onClick={() => void refresh()}
              >
                {t('softwareBanner.reprobe')}
              </button>
            </div>
          </div>
        </div>
        <SoftwareUninstallDialog
          open={uninstallOpen}
          feature={feature}
          title={uninstallTitle ?? readyTitle ?? title}
          busy={uninstallBusy}
          onClose={() => !uninstallBusy && setUninstallOpen(false)}
          onConfirm={runUninstall}
        />
      </div>
    );
  }

  if (ready && !error && !lastResult && !switchOpen && !installedAny) {
    return null;
  }

  return (
    <div className="software-install-banner">
      {!ready && missingList.length > 0 ? (
        <div className="software-install-banner__alert" role="status">
          <div className="software-install-banner__row">
            <div className="software-install-banner__text">
              <h3 className="software-install-banner__title">
                {title ?? t('softwareBanner.titleDefault')}
              </h3>
              <p className="software-install-banner__desc">
                {t('softwareBanner.missing', { names })}
              </p>
              {(feature === 'mysql' || feature === 'mariadb') && (
                <p className="software-install-banner__desc muted u-text-sm">
                  {t('sqlEngineSwitch.bannerHint')}
                </p>
              )}
            </div>
            <div className="software-install-banner__actions">
              <button
                type="button"
                className={buttonClassName({ variant: 'primary', size: 'md' })}
                disabled={busy || stream?.isBusy}
                onClick={() => void runInstall()}
              >
                {busy
                  ? t('softwareBanner.installing')
                  : t('softwareBanner.installOneClick')}
              </button>
              {installedAny ? (
                <button
                  type="button"
                  className={buttonClassName({ variant: 'danger', size: 'sm' })}
                  disabled={busy || uninstallBusy || stream?.isBusy}
                  onClick={() => setUninstallOpen(true)}
                >
                  {t('softwareLifecycle.uninstall')}
                </button>
              ) : null}
              <button
                type="button"
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMsg(null);
                  void refresh();
                }}
              >
                {t('softwareBanner.reprobe')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {opsResult && (error || lastResult) ? (
        <div className="software-install-banner__result">
          <OpsResultPanel
            title={t('softwareBanner.resultTitle')}
            result={opsResult}
            onRetry={
              !ready
                ? () => void runInstall()
                : undefined
            }
            busy={busy}
          />
        </div>
      ) : null}

      <SqlEngineSwitchDialog
        open={switchOpen}
        preview={switchPreview}
        busy={busy}
        onClose={() => setSwitchOpen(false)}
        onConfirm={() =>
          void confirmSwitch().then((r) => {
            if (r.ok) onInstalled?.();
          })
        }
      />

      <SoftwareUninstallDialog
        open={uninstallOpen}
        feature={feature}
        title={uninstallTitle ?? readyTitle ?? title}
        busy={uninstallBusy}
        onClose={() => !uninstallBusy && setUninstallOpen(false)}
        onConfirm={runUninstall}
      />
    </div>
  );
}
