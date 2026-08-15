/**
 * Shared start / stop / restart / reload toolbar for host daemons.
 * Uses POST /api/v1/system/services/lifecycle unless onAction is provided.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog } from '../../shared/components/ui';
import type { ConfirmSeverity } from '../../shared/components/ui';
import { systemApi } from './api';
import { useFeatureAction } from './useFeatureAction';

export type ServiceLifecycleAction = 'start' | 'stop' | 'restart' | 'reload';
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
}: ServiceLifecycleBarProps) {
  const { t } = useTranslation();
  const { busy, run } = useFeatureAction();
  const [resolvedUnit, setResolvedUnit] = useState(unitProp?.trim() || '');
  const [pendingStop, setPendingStop] = useState(false);

  useEffect(() => {
    if (unitProp?.trim()) {
      setResolvedUnit(unitProp.trim());
      return;
    }
    if (!matrixId) return;
    let cancelled = false;
    void systemApi
      .servicesMatrix()
      .then((r) => {
        if (cancelled) return;
        const row = (r.items ?? []).find((x) => x.id === matrixId);
        if (row?.unit && row.unit !== '—') setResolvedUnit(row.unit);
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
        description: t('services.stopConfirmPanelDesc'),
        confirmText: t('services.stopConfirmPanelToken'),
        severity: 'critical' as ConfirmSeverity,
        consequences: [t('services.stopConfirmPanelConsequence')],
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
  }, [danger, label, t]);

  const okMessage = useCallback(
    (action: ServiceLifecycleAction) => {
      if (action === 'stop') return t('services.stoppedOk', { label });
      if (action === 'start') return t('services.startedOk', { label });
      if (action === 'reload') return t('services.reloadedOk', { label });
      return t('services.restartedOk', { label });
    },
    [label, t],
  );

  const fire = useCallback(
    async (action: ServiceLifecycleAction) => {
      if (!canAct) return;
      await run(async () => {
        if (onAction) {
          const r = await onAction(action);
          await onDone?.();
          return r;
        }
        const r = await systemApi.serviceLifecycle({ unit, action });
        await onDone?.();
        return r;
      }, okMessage(action));
    },
    [canAct, onAction, onDone, okMessage, run, unit],
  );

  if (!installed) return null;

  const show = (a: ServiceLifecycleAction) => actions.includes(a);

  return (
    <div
      className={['lifecycle-toolbar', className ?? ''].filter(Boolean).join(' ')}
      role="group"
      aria-label={t('services.lifecycleTitle', { label })}
    >
      {show('start') && running !== true ? (
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
          disabled={!canAct || running === false}
          title={danger === 'panel' ? t('services.stopConfirmPanelDesc') : undefined}
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
          disabled={!canAct || running === false}
          onClick={() => void fire('restart')}
        >
          {t('services.action.restart')}
        </Button>
      ) : null}
      {show('reload') ? (
        <Button
          variant="secondary"
          size={size}
          loading={busy}
          disabled={!canAct || running === false}
          onClick={() => void fire('reload')}
        >
          {t('services.action.reload')}
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
        description={confirmCopy.description}
        consequences={confirmCopy.consequences}
        confirmText={confirmCopy.confirmText}
        severity={confirmCopy.severity}
        confirmLabel={t('services.action.stop')}
        busy={busy}
      />
    </div>
  );
}
