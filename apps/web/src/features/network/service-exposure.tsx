/**
 * Service network access — status strip + manage/exposure dialog.
 * Replaces per-service "open firewall port" CTAs.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Field,
  FormActions,
  FormHint,
  Modal,
  SegRadio,
} from '../../shared/components/ui';
import type { BadgeTone } from '../../shared/components/ui';
import { systemApi } from '../system';

export type ExposureMode = 'private' | 'public' | 'restricted';

export type ServicePortBinding = {
  role: string;
  port: string;
  proto?: string;
};

export type ExposureStatus = {
  serviceId: string;
  mode: ExposureMode;
  ports: ServicePortBinding[];
  allowFrom: string[];
  allowCountries: string[];
  decided: boolean;
  inSync: boolean;
  defaultMode: ExposureMode;
  liveCount: number;
  firewallInstalled?: boolean;
  firewallActive?: string;
  firewallActiveLabel?: string;
};

function emptyStatus(serviceId: string): ExposureStatus {
  return {
    serviceId,
    mode: 'public',
    ports: [],
    allowFrom: [],
    allowCountries: [],
    decided: false,
    inSync: true,
    defaultMode: 'public',
    liveCount: 0,
  };
}

export async function fetchExposureStatus(serviceId: string): Promise<ExposureStatus> {
  const r = await systemApi.serviceExposureGet(serviceId);
  const d = r.desired as {
    mode?: ExposureMode;
    ports?: ServicePortBinding[];
    allowFrom?: string[];
    allowCountries?: string[];
    decided?: boolean;
  };
  return {
    serviceId,
    mode: d?.mode ?? 'public',
    ports: (d?.ports ?? []) as ServicePortBinding[],
    allowFrom: d?.allowFrom ?? [],
    allowCountries: d?.allowCountries ?? [],
    decided: Boolean(d?.decided),
    inSync: Boolean(r.inSync),
    defaultMode: r.defaultMode ?? 'public',
    liveCount: Array.isArray(r.liveRules) ? r.liveRules.length : 0,
    firewallInstalled: r.firewall?.installed,
    firewallActive: r.firewall?.active,
    firewallActiveLabel: r.firewall?.activeLabel,
  };
}

function formatPorts(ports: ServicePortBinding[]): string {
  if (!ports.length) return '—';
  return ports
    .map((p) => {
      const proto = p.proto && p.proto !== 'tcp' ? `/${p.proto}` : '';
      return `${p.port}${proto}`;
    })
    .join(', ');
}

function modeTone(mode: ExposureMode, inSync: boolean): BadgeTone {
  if (!inSync) return 'warn';
  if (mode === 'public') return 'ok';
  if (mode === 'restricted') return 'info';
  return 'neutral';
}

function modeLabel(
  mode: ExposureMode,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (mode === 'private') return t('serviceExposure.modePrivate');
  if (mode === 'restricted') return t('serviceExposure.modeRestricted');
  return t('serviceExposure.modePublic');
}

export type ServiceAccessStripProps = {
  serviceId: string;
  /** Override ports shown (e.g. current form values before save) */
  ports?: ServicePortBinding[];
  /** Compact inline in action bars */
  compact?: boolean;
  className?: string;
  onUpdated?: () => void;
};

export function ServiceAccessStrip({
  serviceId,
  ports: portsOverride,
  compact,
  className,
  onUpdated,
}: ServiceAccessStripProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ExposureStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      setStatus(await fetchExposureStatus(serviceId));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.loadFailed'));
      setStatus(emptyStatus(serviceId));
    }
  }, [serviceId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ports = portsOverride?.length ? portsOverride : status?.ports ?? [];
  const mode = status?.mode ?? 'public';
  const inSync = status?.inSync ?? true;
  const fwOff =
    status?.firewallInstalled === false ||
    (status?.firewallActive != null &&
      status.firewallActive !== 'active' &&
      !/active/i.test(status.firewallActive));
  const summary = useMemo(() => {
    if (fwOff) {
      return t('serviceExposure.summaryFirewallOff', {
        detail:
          status?.firewallActiveLabel ||
          (status?.firewallInstalled === false
            ? t('serviceExposure.ufwMissing')
            : t('serviceExposure.ufwInactive')),
      });
    }
    if (mode === 'private') return t('serviceExposure.summaryPrivate');
    if (mode === 'restricted') {
      const n = status?.allowFrom.length ?? 0;
      return t('serviceExposure.summaryRestricted', { count: n });
    }
    return t('serviceExposure.summaryPublic', { ports: formatPorts(ports) });
  }, [mode, ports, status, fwOff, t]);

  return (
    <>
      <div
        className={['service-access-strip', compact ? 'service-access-strip--compact' : '', className]
          .filter(Boolean)
          .join(' ')}
        role="group"
        aria-label={t('serviceExposure.title')}
      >
        <div className="service-access-strip__body">
          <div className="service-access-strip__meta">
            <span className="service-access-strip__label">{t('serviceExposure.title')}</span>
            <Badge tone={modeTone(mode, inSync)}>{modeLabel(mode, t)}</Badge>
            {!inSync ? <Badge tone="warn">{t('serviceExposure.outOfSync')}</Badge> : null}
            {fwOff ? <Badge tone="warn">{t('serviceExposure.firewallOff')}</Badge> : null}
          </div>
          <p className="service-access-strip__summary muted">{summary}</p>
          <p className="service-access-strip__summary muted u-text-sm">
            {t('serviceExposure.cloudSgNote')}
          </p>
          {loadError ? <p className="service-access-strip__err">{loadError}</p> : null}
        </div>
        <div className="service-access-strip__actions">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => setManageOpen(true)}
          >
            {t('serviceExposure.manage')}
          </Button>
          <Link className="btn btn--secondary btn--sm" to="/firewall?tab=services">
            {t('serviceExposure.firewallLink')}
          </Link>
        </div>
      </div>
      <ServiceExposureDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        serviceId={serviceId}
        ports={ports}
        initial={status}
        title={t('serviceExposure.manageTitle')}
        onSaved={async () => {
          setBusy(true);
          try {
            await refresh();
            onUpdated?.();
          } finally {
            setBusy(false);
            setManageOpen(false);
          }
        }}
      />
    </>
  );
}

export type ServiceExposureDialogProps = {
  open: boolean;
  onClose: () => void;
  serviceId: string;
  ports?: ServicePortBinding[];
  initial?: ExposureStatus | null;
  title?: string;
  /** Start-flow: confirm then parent starts service */
  confirmLabel?: string;
  onSaved?: (decision: {
    mode: ExposureMode;
    allowFrom: string[];
    allowCountries: string[];
    exposureDecision: 'keep-private' | 'public' | 'restricted';
  }) => void | Promise<void>;
  /** When true, only returns decision without PUT (parent will start+sync) */
  decisionOnly?: boolean;
};

const COMMON_COUNTRIES = [
  'HK',
  'CN',
  'TW',
  'JP',
  'KR',
  'SG',
  'US',
  'GB',
  'DE',
  'AU',
  'CA',
  'IN',
];

export function ServiceExposureDialog({
  open,
  onClose,
  serviceId,
  ports,
  initial,
  title,
  confirmLabel,
  onSaved,
  decisionOnly,
}: ServiceExposureDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ExposureMode>('private');
  const [allowRaw, setAllowRaw] = useState('');
  const [countriesRaw, setCountriesRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const m = initial?.mode ?? initial?.defaultMode ?? 'private';
    setMode(m === 'public' || m === 'restricted' || m === 'private' ? m : 'private');
    setAllowRaw((initial?.allowFrom ?? []).join(', '));
    setCountriesRaw((initial?.allowCountries ?? []).join(', '));
    setError(null);
  }, [open, initial]);

  function parseAllowFrom(): string[] {
    return allowRaw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 64);
  }

  function parseCountries(): string[] {
    return countriesRaw
      .split(/[\s,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s))
      .slice(0, 32);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const allowFrom = parseAllowFrom();
    const allowCountries = parseCountries();
    if (mode === 'restricted' && allowFrom.length === 0 && allowCountries.length === 0) {
      setError(t('serviceExposure.restrictedNeedSource'));
      setBusy(false);
      return;
    }
    const exposureDecision =
      mode === 'private' ? 'keep-private' : mode === 'restricted' ? 'restricted' : 'public';
    try {
      if (!decisionOnly) {
        await systemApi.serviceExposurePut(serviceId, {
          mode,
          ports,
          allowFrom: mode === 'restricted' ? allowFrom : [],
          allowCountries: mode === 'restricted' ? allowCountries : [],
          sync: true,
        });
      }
      await onSaved?.({ mode, allowFrom, allowCountries, exposureDecision });
      if (!onSaved) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? t('serviceExposure.manageTitle')}
      description={t('serviceExposure.manageDesc', { service: serviceId })}
      size="md"
      footer={
        <FormActions>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            loading={busy}
            form="service-exposure-form"
            type="submit"
          >
            {confirmLabel ?? t('common.save')}
          </Button>
        </FormActions>
      }
    >
      <form id="service-exposure-form" onSubmit={(e) => void onSubmit(e)}>
        {error ? <p className="form-error u-mb-3">{error}</p> : null}
        {ports?.length ? (
          <p className="form-hint u-mb-3">
            {t('serviceExposure.portsLabel')}: {formatPorts(ports)}
          </p>
        ) : null}
        <Field label={t('serviceExposure.mode')} htmlFor="exp-mode" flush>
          <SegRadio
            name="exp-mode"
            aria-label={t('serviceExposure.mode')}
            value={mode}
            onChange={(v) => setMode(v as ExposureMode)}
            options={[
              {
                value: 'private',
                label: t('serviceExposure.modePrivate'),
              },
              {
                value: 'public',
                label: t('serviceExposure.modePublic'),
              },
              {
                value: 'restricted',
                label: t('serviceExposure.modeRestricted'),
              },
            ]}
          />
        </Field>
        {mode === 'private' ? (
          <FormHint>{t('serviceExposure.hintPrivate')}</FormHint>
        ) : null}
        {mode === 'public' ? (
          <p className="form-hint service-access-strip__warn">{t('serviceExposure.hintPublic')}</p>
        ) : null}
        {mode === 'restricted' ? (
          <div className="u-mt-3" style={{ display: 'grid', gap: '0.75rem' }}>
            <Field label={t('serviceExposure.allowFrom')} htmlFor="exp-allow" flush>
              <input
                id="exp-allow"
                className="u-input"
                value={allowRaw}
                onChange={(e) => setAllowRaw(e.target.value)}
                placeholder="203.0.113.10, 10.0.0.0/8"
                aria-label={t('serviceExposure.allowFrom')}
              />
              <FormHint>{t('serviceExposure.hintRestricted')}</FormHint>
            </Field>
            <Field label={t('serviceExposure.allowCountries')} htmlFor="exp-cc" flush>
              <input
                id="exp-cc"
                className="u-input"
                value={countriesRaw}
                onChange={(e) => setCountriesRaw(e.target.value)}
                placeholder="HK, CN, US"
                aria-label={t('serviceExposure.allowCountries')}
              />
              <FormHint>{t('serviceExposure.hintCountries')}</FormHint>
              <div className="u-flex u-flex-wrap u-gap-1 u-mt-2">
                {COMMON_COUNTRIES.map((cc) => (
                  <button
                    key={cc}
                    type="button"
                    className="btn btn--ghost btn--md"
                    style={{ minHeight: 32, padding: '0 0.5rem', fontSize: '0.8rem' }}
                    onClick={() => {
                      const cur = parseCountries();
                      if (cur.includes(cc)) {
                        setCountriesRaw(cur.filter((c) => c !== cc).join(', '));
                      } else {
                        setCountriesRaw([...cur, cc].join(', '));
                      }
                    }}
                  >
                    {cc}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

/**
 * Hook: gate private-service start with exposure dialog when needed.
 */
export function usePrivateStartGate(serviceId: string, ports?: ServicePortBinding[]) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<ExposureStatus | null>(null);

  const prepareStart = useCallback(async (): Promise<
    | { proceed: true; exposureDecision?: 'keep-private' | 'public' | 'restricted'; allowFrom?: string[] }
    | { proceed: false; needsDialog: true }
  > => {
    try {
      const st = await fetchExposureStatus(serviceId);
      setStatus(st);
      if (st.defaultMode === 'private' && !st.decided) {
        setPending(true);
        return { proceed: false, needsDialog: true };
      }
      return { proceed: true };
    } catch {
      return { proceed: true };
    }
  }, [serviceId]);

  const dismiss = useCallback(() => setPending(false), []);

  return {
    pending,
    status,
    ports,
    prepareStart,
    dismiss,
    setPending,
  };
}
