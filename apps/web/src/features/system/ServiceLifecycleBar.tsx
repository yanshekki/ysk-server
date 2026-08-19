/**
 * Shared start / stop / restart / reload toolbar for host daemons.
 * Uses POST /api/v1/system/services/lifecycle unless onAction is provided.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, OpsResultPanel } from '../../shared/components/ui';
import type { ConfirmSeverity } from '../../shared/components/ui';
import { ApiError } from '../../shared/services/api';
import { systemApi } from './api';
import { useFeatureAction } from './useFeatureAction';

export type ServiceLifecycleAction = 'start' | 'stop' | 'restart' | 'reload' | 'enable';
export type ServiceLifecycleDanger = 'normal' | 'edge' | 'sshd' | 'panel' | 'fail2ban';

export type ServiceLifecycleBarProps = {
  /** systemd unit, e.g. vsftpd / nginx / apache2 */
  unit?: string;
  /** Resolve unit from /services matrix when unit is omitted */
  matrixId?: string;
  label: string;
  installed?: boolean;
  running?: boolean;
  actions?: ServiceLifecycleAction[];
  danger?: ServiceLifecycleDanger;
  size?: 'sm' | 'md';
  className?: string;
  onDone?: () => void | Promise<void>;
  /** Override host call (VPN ensure/stop, etc.) */
  onAction?: (action: ServiceLifecycleAction) => Promise<unknown>;
  /** Extra sentence on the stop confirm (e.g. container count). */
  stopDetail?: string;
  /** After start/restart, re-probe. Return ok:false to avoid a success toast. */
  verifyAfter?: (
    action: ServiceLifecycleAction,
  ) => Promise<{ ok: boolean; notes?: string[]; blockMessage?: string } | void>;
  /** Show the last start/stop result under the toolbar (toasts still fire). */
  showResult?: boolean;
  extraAfterResult?: ReactNode;
};

const DEFAULT_ACTIONS: ServiceLifecycleAction[] = ['start', 'stop', 'restart'];

export function ServiceLifecycleBar({
  unit: unitProp,
  matrixId,
  label,
  installed = true,
  running,
  actions = DEFAULT_ACTIONS,
  danger = 'normal',
  size = 'md',
  className,
  onDone,
  onAction,
  stopDetail,
  verifyAfter,
  showResult = false,
  extraAfterResult,
}: ServiceLifecycleBarProps) {
  const { t } = useTranslation();
  const { busy, run, result } = useFeatureAction();
  const [resolvedUnit, setResolvedUnit] = useState(unitProp?.trim() || '');
  const [matrixRunning, setMatrixRunning] = useState<boolean | undefined>(undefined);
  const [pendingStop, setPendingStop] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);
  const [pendingReload, setPendingReload] = useState(false);
  const [pendingEnable, setPendingEnable] = useState(false);
  const confirmLifecycle = danger === 'panel' || danger === 'edge' || danger === 'sshd';
  const [bootEnabled, setBootEnabled] = useState<string | undefined>();
  const [sshdBootOff, setSshdBootOff] = useState(false);

  useEffect(() => {
    if (danger !== 'panel') return;
    let cancelled = false;
    void systemApi
      .servicesMatrix()
      .then((r) => {
        if (cancelled) return;
        const row = (r.items ?? []).find((x) => {
          const blob = `${x.id ?? ''} ${x.unit ?? ''}`.toLowerCase();
          return blob.includes('sshd') || /(^|\s)ssh(\s|$)/.test(blob);
        });
        setSshdBootOff(
          Boolean(row && row.installed !== false && String(row.enabled) !== 'enabled'),
        );
      })
      .catch(() => {
        /* keep false — do not invent sshd-off */
      });
    return () => {
      cancelled = true;
    };
  }, [danger]);

  useEffect(() => {
    if (unitProp?.trim()) {
      setResolvedUnit(unitProp.trim());
    }
    if (!matrixId && unitProp?.trim()) return;
    if (!matrixId) return;
    let cancelled = false;
    void systemApi
      .servicesMatrix()
      .then((r) => {
        if (cancelled) return;
        const row = (r.items ?? []).find((x) => x.id === matrixId);
        if (!unitProp?.trim() && row?.unit && row.unit !== '—') setResolvedUnit(row.unit);
        if (row?.enabled) setBootEnabled(row.enabled);
        const act = String(row?.active ?? '').toLowerCase();
        if (act === 'active' || act === 'running') setMatrixRunning(true);
        else if (act === 'inactive' || act === 'failed' || act === 'stopped') setMatrixRunning(false);
      })
      .catch(() => {
        /* keep empty — buttons stay disabled */
      });
    return () => {
      cancelled = true;
    };
  }, [unitProp, matrixId]);

  const unit = resolvedUnit;
  const canAct = Boolean(installed && (unit || onAction));
  const isRunning = running ?? matrixRunning;

  const confirmCopy = useMemo(() => {
    if (danger === 'fail2ban') {
      return {
        title: t('services.stopConfirmFail2banTitle'),
        description: t('services.stopConfirmFail2banDesc'),
        confirmText: undefined,
        severity: 'standard' as ConfirmSeverity,
        consequences: [t('services.stopConfirmFail2banConsequence')],
      };
    }
    if (danger === 'sshd') {
      return {
        title: t('services.stopConfirmSshdTitle'),
        description: t('services.stopConfirmSshdDesc'),
        confirmText: t('services.stopConfirmSshdToken'),
        severity: 'critical' as ConfirmSeverity,
        consequences: [t('services.stopConfirmSshdConsequence')],
      };
    }
    if (danger === 'panel') {
      return {
        title: t('services.stopConfirmPanelTitle'),
        description: sshdBootOff
          ? t('services.stopConfirmPanelSshdOffDesc')
          : t('services.stopConfirmPanelDesc'),
        confirmText: t('services.stopConfirmPanelToken'),
        severity: 'critical' as ConfirmSeverity,
        consequences: [
          t('services.stopConfirmPanelConsequence'),
          ...(sshdBootOff ? [t('services.stopConfirmPanelSshdOffConsequence')] : []),
        ],
      };
    }
    return {
      title: t('services.stopConfirmTitle', { label }),
      description:
        danger === 'edge'
          ? t('services.stopConfirmEdgeDesc', { label })
          : t('services.stopConfirmDesc', { label }),
      confirmText: undefined,
      severity: (danger === 'edge' ? 'destructive' : 'standard') as ConfirmSeverity,
      consequences:
        danger === 'edge' ? [t('services.stopConfirmEdgeConsequence', { label })] : undefined,
    };
  }, [danger, label, t, sshdBootOff]);

  const okMessage = useCallback(
    (action: ServiceLifecycleAction) => {
      if (action === 'stop') return t('services.stoppedOk', { label });
      if (action === 'start') return t('services.startedOk', { label });
      if (action === 'reload') return t('services.reloadedOk', { label });
      if (action === 'enable') return t('services.enabledOk', { label });
      return t('services.restartedOk', { label });
    },
    [label, t],
  );

  const fire = useCallback(
    async (action: ServiceLifecycleAction) => {
      if (!canAct) return;
      await run(async () => {
        let r: unknown = { ok: false };
        try {
          if (onAction) {
            r = await onAction(action);
          } else {
            r = await systemApi.serviceLifecycle({ unit, action });
            if (matrixId) {
              try {
                const mx = await systemApi.servicesMatrix();
                const row = (mx.items ?? []).find((x) => x.id === matrixId);
                if (row?.enabled) setBootEnabled(row.enabled);
              } catch {
                /* ignore */
              }
            }
          }
        } catch (e) {
          r =
            e instanceof ApiError && e.details && typeof e.details === 'object'
              ? { ...(e.details as Record<string, unknown>), ok: false }
              : {
                  ok: false,
                  notes: [
                    e instanceof Error ? e.message : t('services.startVerifyFailed', { label }),
                  ],
                };
        }
        try {
          await Promise.resolve(onDone?.());
        } catch {
          /* refresh must not hide the lifecycle result */
        }
        if (verifyAfter && (action === 'start' || action === 'restart')) {
          const v = await verifyAfter(action);
          if (v && v.ok === false) {
            const notes = v.notes?.length
              ? v.notes
              : [t('services.startVerifyFailed', { label })];
            return {
              ok: false,
              notes,
              blockMessage: v.blockMessage?.trim() || notes[0],
            };
          }
        }
        return r;
      }, okMessage(action));
    },
    [canAct, onAction, onDone, okMessage, run, unit, verifyAfter, t, label, matrixId],
  );

  if (!installed) return null;

  const show = (a: ServiceLifecycleAction) => actions.includes(a);

  return (
    <div
      className={['lifecycle-toolbar', className ?? ''].filter(Boolean).join(' ')}
      role="group"
      aria-label={t('services.lifecycleTitle', { label })}
    >
      {show('start') && isRunning !== true ? (
        <Button
          variant="primary"
          size={size}
          loading={busy}
          disabled={!canAct}
          onClick={() => void fire('start')}
        >
          {t('services.action.start')}
        </Button>
      ) : null}
      {show('stop') ? (
        <Button
          variant="danger"
          size={size}
          loading={busy}
          disabled={!canAct || isRunning === false}
          title={
            isRunning === false
              ? t('services.needRunning', { label })
              : danger === 'panel'
                ? sshdBootOff
                  ? t('services.stopConfirmPanelSshdOffDesc')
                  : t('services.stopConfirmPanelDesc')
                : stopDetail
                  ? `${t('services.stopConfirmTitle', { label })} ${stopDetail}`
                  : t('services.stopConfirmTitle', { label })
          }
          data-confirm="dialog"
          onClick={() => setPendingStop(true)}
        >
          {t('services.action.stop')}
        </Button>
      ) : null}
      {show('restart') ? (
        <Button
          variant="secondary"
          size={size}
          loading={busy}
          disabled={!canAct || isRunning === false}
          title={
            danger === 'panel'
              ? sshdBootOff
                ? t('services.stopConfirmPanelSshdOffDesc')
                : t('services.stopConfirmPanelDesc')
              : t('services.restartConfirmTitle', { label })
          }
          data-confirm={confirmLifecycle ? 'dialog' : undefined}
          onClick={() => {
            if (confirmLifecycle) setPendingRestart(true);
            else void fire('restart');
          }}
        >
          {t('services.action.restart')}
        </Button>
      ) : null}
      {show('reload') ? (
        <Button
          variant="secondary"
          size={size}
          loading={busy}
          disabled={!canAct || isRunning === false}
          title={t('services.reloadTitle', { label })}
          data-confirm={danger === 'sshd' ? 'dialog' : undefined}
          onClick={() => {
            if (danger === 'sshd') setPendingReload(true);
            else void fire('reload');
          }}
        >
          {t('services.action.reload')}
        </Button>
      ) : null}
      {show('enable') && bootEnabled && bootEnabled !== 'enabled' ? (
        <Button
          variant="secondary"
          size={size}
          loading={busy}
          disabled={!canAct}
          title={t('services.bootDisabledWarn', { label })}
          data-confirm={danger === 'sshd' ? 'dialog' : undefined}
          onClick={() => {
            if (danger === 'sshd') setPendingEnable(true);
            else void fire('enable');
          }}
        >
          {t('services.action.enable')}
        </Button>
      ) : null}

      <ConfirmDialog
        open={pendingStop}
        onClose={() => setPendingStop(false)}
        onConfirm={() => {
          setPendingStop(false);
          void fire('stop');
        }}
        title={confirmCopy.title}
        description={
          stopDetail ? `${confirmCopy.description} ${stopDetail}` : confirmCopy.description
        }
        consequences={confirmCopy.consequences}
        confirmText={confirmCopy.confirmText}
        severity={confirmCopy.severity}
        confirmLabel={t('services.action.stop')}
        busy={busy}
      />
      <ConfirmDialog
        open={pendingRestart}
        onClose={() => setPendingRestart(false)}
        onConfirm={() => {
          setPendingRestart(false);
          void fire('restart');
        }}
        title={
          danger === 'panel'
            ? t('services.restartConfirmPanelTitle')
            : t('services.restartConfirmTitle', { label })
        }
        description={
          danger === 'panel'
            ? t('services.restartConfirmPanelDesc')
            : t('services.restartConfirmDesc', { label })
        }
        consequences={
          danger === 'edge'
            ? [t('services.restartConfirmConsequence', { label }), stopDetail].filter(
                (x): x is string => Boolean(x),
              )
            : confirmCopy.consequences
        }
        confirmText={confirmCopy.confirmText}
        severity={confirmCopy.severity}
        confirmLabel={t('services.action.restart')}
        busy={busy}
      />
      <ConfirmDialog
        open={pendingReload}
        onClose={() => setPendingReload(false)}
        onConfirm={() => {
          setPendingReload(false);
          void fire('reload');
        }}
        title={t('services.reloadConfirmTitle', { label })}
        description={t('services.reloadConfirmDesc', { label })}
        severity="standard"
        confirmLabel={t('services.action.reload')}
        busy={busy}
      />
      <ConfirmDialog
        open={pendingEnable}
        onClose={() => setPendingEnable(false)}
        onConfirm={() => {
          setPendingEnable(false);
          void fire('enable');
        }}
        title={t('services.enableConfirmTitle', { label })}
        description={t('services.enableConfirmDesc', { label })}
        severity="standard"
        confirmLabel={t('services.action.enable')}
        busy={busy}
      />
      {showResult && result ? (
        <OpsResultPanel
          title={t('services.lifecycleTitle', { label })}
          result={result}
          defaultShowTechnical={!result.ok}
        />
      ) : null}
      {extraAfterResult}
    </div>
  );
}
