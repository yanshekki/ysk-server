/**
 * Bundle/plan install + uninstall wizard (panel).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, ConfirmDialog, Field, LoadingBlock, OpsResultPanel } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import {
  softwareApi,
  type StackBundle,
  type StackOpResult,
  type StackPlan,
  type StackStatusResponse } from './api';

const ALL_BUNDLE_IDS = [
  'web',
  'database',
  'email',
  'dns',
  'ftp',
  'defense',
  'runtimes',
] as const;

export function StackWizard() {
  const { t, i18n } = useTranslation();
  const zh = i18n.language?.startsWith('zh');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StackStatusResponse | null>(null);
  const [plans, setPlans] = useState<StackPlan[]>([]);
  const [bundles, setBundles] = useState<StackBundle[]>([]);
  const [mode, setMode] = useState<'install' | 'uninstall'>('install');
  const [plan, setPlan] = useState('recommended');
  const [custom, setCustom] = useState<string[]>(['web', 'database', 'defense']);
  const [sqlServer, setSqlServer] = useState<'mariadb' | 'mysql'>('mariadb');
  const [clamav, setClamav] = useState(false);
  const [preview, setPreview] = useState<string[]>([]);
  const [unBundles, setUnBundles] = useState<string[]>([]);
  const [dataPolicy, setDataPolicy] = useState<'keep' | 'purge'>('keep');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StackOpResult | null>(null);
  const [uninstallConfirm, setUninstallConfirm] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [st, pl] = await Promise.all([softwareApi.stackStatus(), softwareApi.stackPlans()]);
      setStatus(st);
      setPlans(pl.plans ?? st.plans ?? []);
      setBundles(pl.bundles ?? st.bundles ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const selectedBundles = useMemo(() => {
    if (plan === 'custom') return ['control-plane', ...custom];
    const p = plans.find((x) => x.id === plan);
    return p?.bundles ?? ['control-plane'];
  }, [plan, custom, plans]);

  useEffect(() => {
    if (mode !== 'install') return;
    let cancelled = false;
    void softwareApi
      .stackExpand({
        plan: plan === 'custom' ? undefined : plan,
        bundles: plan === 'custom' ? selectedBundles : undefined,
        sqlServer,
        clamav })
      .then((r) => {
        if (!cancelled && r.ok && r.components) setPreview(r.components);
      })
      .catch(() => {
        if (!cancelled) setPreview([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, plan, selectedBundles, sqlServer, clamav]);

  function titleOf(p: StackPlan | StackBundle) {
    if (zh && 'titleZh' in p && p.titleZh) return p.titleZh;
    return p.title;
  }

  async function runInstall(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await softwareApi.stackInstall({
        plan: plan === 'custom' ? undefined : plan,
        bundles: plan === 'custom' ? selectedBundles : undefined,
        sqlServer,
        clamav,
        dryRun });
      setResult(r);
      if (!dryRun) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function runUninstall(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (dataPolicy === 'purge' && !dryRun) {
        const ok = window.confirm(t('stackWizard.purgeConfirm'));
        if (!ok) {
          setBusy(false);
          return;
        }
      }
      const r = await softwareApi.stackUninstall({
        bundles: unBundles.length ? unBundles : undefined,
        all: unBundles.length === 0,
        dataPolicy,
        dryRun });
      setResult(r);
      if (!dryRun) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  }

  function toggleCustom(id: string) {
    setCustom((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleUn(id: string) {
    setUnBundles((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  if (loading) return <LoadingBlock />;

  const canMutate = Boolean(status?.executeEnabled && status?.isRoot);
  const missing = status?.components.filter((c) => !c.installed).length ?? 0;
  const installed = status?.components.filter((c) => c.installed).length ?? 0;

  return (
    <div className="stack-wizard" data-testid="stack-wizard">
      <div className="stack-wizard__status u-flex u-flex-wrap u-gap-3 u-mb-4">
        <Badge tone={canMutate ? 'ok' : 'warn'}>
          EXECUTE {status?.executeEnabled ? 'ON' : 'OFF'} / root {status?.isRoot ? 'yes' : 'no'}
        </Badge>
        <Badge tone="neutral">
          {t('stackWizard.installedCount', { installed, missing })}
        </Badge>
        <Badge tone="neutral">
          manifest: {status?.manifest?.plan || '—'} ({(status?.manifest?.bundles ?? []).join(', ') || '—'})
        </Badge>
      </div>

      {!canMutate ? <Alert variant="info">{t('stackWizard.needRootExecute')}</Alert> : null}

      <div className="stack-wizard__mode-bar u-flex u-gap-2 u-mb-4">
        <Button variant={mode === 'install' ? 'primary' : 'secondary'} onClick={() => setMode('install')}>
          {t('stackWizard.modeInstall')}
        </Button>
        <Button variant={mode === 'uninstall' ? 'primary' : 'secondary'} onClick={() => setMode('uninstall')}>
          {t('stackWizard.modeUninstall')}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
        >
          {t('common.refresh')}
        </Button>
      </div>

      {mode === 'install' ? (
        <div className="stack-wizard__install">
          <Field label={t('stackWizard.plan')} htmlFor="stack-plan-select">
            <select
              id="stack-plan-select"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              data-testid="stack-plan-select"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {titleOf(p)} — {p.bundles.join(', ')}
                </option>
              ))}
              <option value="custom">{t('stackWizard.customBundles')}</option>
            </select>
          </Field>

          {plan === 'custom' ? (
            <div className="stack-wizard__checks u-mt-3 u-mb-3">
              {ALL_BUNDLE_IDS.map((id) => {
                const b = bundles.find((x) => x.id === id);
                return (
                  <label key={id} className="stack-wizard__check-row u-flex u-gap-2 u-items-center">
                    <input
                      type="checkbox"
                      checked={custom.includes(id)}
                      onChange={() => toggleCustom(id)}
                    />
                    <span>
                      {b ? titleOf(b) : id}
                      <small className="muted"> ({id})</small>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}

          {(plan === 'full' || plan === 'recommended' || plan === 'custom') &&
          selectedBundles.includes('database') ? (
            <Field label={t('stackWizard.sqlExclusive')} htmlFor="stack-sql">
              <select
                id="stack-sql"
                value={sqlServer}
                onChange={(e) => setSqlServer(e.target.value as 'mariadb' | 'mysql')}
              >
                <option value="mariadb">MariaDB</option>
                <option value="mysql">MySQL</option>
              </select>
            </Field>
          ) : null}

          {selectedBundles.includes('email') ? (
            <label className="stack-wizard__check-row u-flex u-gap-2 u-items-center u-mt-2 u-mb-2">
              <input type="checkbox" checked={clamav} onChange={(e) => setClamav(e.target.checked)} />
              ClamAV ({t('stackWizard.clamavOptional')})
            </label>
          ) : null}

          <div className="stack-wizard__preview u-mt-3 u-mb-3">
            <strong>{t('stackWizard.componentsTitle')}</strong> ({preview.length})
            <ul className="stack-wizard__scroll-list list-plain u-text-sm">
              {preview.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>

          <div className="stack-wizard__actions u-flex u-gap-2 u-flex-wrap">
            <Button disabled={busy} variant="secondary" onClick={() => void runInstall(true)}>
              {t('stackWizard.dryRun')}
            </Button>
            <Button disabled={busy || !canMutate} onClick={() => void runInstall(false)}>
              {t('stackWizard.installNow')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack-wizard__uninstall">
          <Alert variant="info">{t('stackWizard.uninstallHint')}</Alert>
          <div className="stack-wizard__checks u-mt-3 u-mb-3">
            {ALL_BUNDLE_IDS.map((id) => {
              const b = bundles.find((x) => x.id === id);
              return (
                <label key={id} className="stack-wizard__check-row u-flex u-gap-2 u-items-center">
                  <input
                    type="checkbox"
                    checked={unBundles.includes(id)}
                    onChange={() => toggleUn(id)}
                  />
                  <span>{b ? titleOf(b) : id}</span>
                </label>
              );
            })}
          </div>
          <Field label={t('stackWizard.dataPolicy')} htmlFor="stack-data-policy">
            <select
              id="stack-data-policy"
              value={dataPolicy}
              onChange={(e) => setDataPolicy(e.target.value as 'keep' | 'purge')}
            >
              <option value="keep">{t('stackWizard.keepData')}</option>
              <option value="purge">{t('stackWizard.purgeData')}</option>
            </select>
          </Field>
          <div className="stack-wizard__actions u-flex u-gap-2 u-flex-wrap u-mt-3">
            <Button disabled={busy} variant="secondary" onClick={() => void runUninstall(true)}>
              {t('stackWizard.dryRun')}
            </Button>
            <Button
              disabled={busy || !canMutate || unBundles.length === 0}
              variant="danger"
              title={
                unBundles.length === 0 ? t('stackWizard.uninstallNeedSelect') : undefined
              }
              onClick={() => setUninstallConfirm(true)}
            >
              {t('stackWizard.uninstallNow')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={uninstallConfirm}
        onClose={() => !busy && setUninstallConfirm(false)}
        title={t('stackWizard.uninstallConfirmTitle')}
        description={t('stackWizard.uninstallConfirmDesc', { count: unBundles.length })}
        consequences={[
          ...unBundles.map((id) => {
            const b = bundles.find((x) => x.id === id);
            return b ? titleOf(b) : id;
          }),
          dataPolicy === 'purge' ? t('stackWizard.purgeData') : t('stackWizard.keepData'),
        ]}
        confirmText="REMOVE"
        severity="critical"
        confirmLabel={t('stackWizard.uninstallNow')}
        busy={busy}
        onConfirm={() => {
          setUninstallConfirm(false);
          void runUninstall(false);
        }}
      />

      {error ? <Alert variant="error">{error}</Alert> : null}
      {result ? (
        <div className="stack-wizard__result u-mt-4">
          <OpsResultPanel result={result as OpsResultLike} />
          {result.steps?.length ? (
            <ul className="stack-wizard__scroll-list stack-wizard__scroll-list--steps list-plain u-text-sm">
              {result.steps.slice(0, 50).map((s, i) => (
                <li key={`${s.name}-${i}`}>
                  [{s.status}] {s.name}
                  {s.detail ? ` — ${s.detail}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
