/**
 * Bundle/plan install + uninstall wizard (panel).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Field, LoadingBlock, OpsResultPanel } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import {
  softwareApi,
  type StackBundle,
  type StackOpResult,
  type StackPlan,
  type StackStatusResponse,
} from './api';

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
        clamav,
      })
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
        dryRun,
      });
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
        const ok = window.confirm(
          zh
            ? '確定 purge？會刪除已登記的資料目錄（DB／郵件等），不可復原！'
            : 'Confirm PURGE? Registered data paths (DB/mail) will be deleted permanently.',
        );
        if (!ok) {
          setBusy(false);
          return;
        }
      }
      const r = await softwareApi.stackUninstall({
        bundles: unBundles.length ? unBundles : undefined,
        all: unBundles.length === 0,
        dataPolicy,
        dryRun,
      });
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
      <div className="stack-wizard__status" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Badge tone={canMutate ? 'ok' : 'warn'}>
          EXECUTE {status?.executeEnabled ? 'ON' : 'OFF'} / root {status?.isRoot ? 'yes' : 'no'}
        </Badge>
        <Badge tone="neutral">
          {zh ? '已安裝' : 'Installed'} {installed} · {zh ? '未安裝' : 'Missing'} {missing}
        </Badge>
        <Badge tone="neutral">
          manifest: {status?.manifest?.plan || '—'} ({(status?.manifest?.bundles ?? []).join(', ') || '—'})
        </Badge>
      </div>

      {!canMutate ? (
        <Alert variant="info">
          {zh
            ? '真實安裝／移除需要 root + YSK_EXECUTE=1。可先做 dry-run 預覽。'
            : 'Live install/remove needs root + YSK_EXECUTE=1. You can still dry-run.'}
        </Alert>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Button variant={mode === 'install' ? 'primary' : 'secondary'} onClick={() => setMode('install')}>
          {zh ? '安裝套餐' : 'Install plan'}
        </Button>
        <Button variant={mode === 'uninstall' ? 'primary' : 'secondary'} onClick={() => setMode('uninstall')}>
          {zh ? '移除套餐' : 'Uninstall'}
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
          <Field label={zh ? '方案' : 'Plan'} htmlFor="stack-plan-select">
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
              <option value="custom">{zh ? '自訂套餐' : 'Custom bundles'}</option>
            </select>
          </Field>

          {plan === 'custom' ? (
            <div style={{ display: 'grid', gap: 6, margin: '12px 0' }}>
              {ALL_BUNDLE_IDS.map((id) => {
                const b = bundles.find((x) => x.id === id);
                return (
                  <label key={id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={custom.includes(id)}
                      onChange={() => toggleCustom(id)}
                    />
                    <span>
                      {b ? titleOf(b) : id}
                      <small style={{ opacity: 0.7 }}> ({id})</small>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}

          {(plan === 'full' || plan === 'recommended' || plan === 'custom') &&
          selectedBundles.includes('database') ? (
            <Field label={zh ? 'SQL 伺服器（互斥）' : 'SQL server (exclusive)'} htmlFor="stack-sql">
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
            <label style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
              <input type="checkbox" checked={clamav} onChange={(e) => setClamav(e.target.checked)} />
              ClamAV ({zh ? '可選、體積大' : 'optional, large'})
            </label>
          ) : null}

          <div style={{ margin: '12px 0' }}>
            <strong>{zh ? '將安裝組件' : 'Components to install'}</strong> ({preview.length})
            <ul style={{ maxHeight: 180, overflow: 'auto', fontSize: 13 }}>
              {preview.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button disabled={busy} variant="secondary" onClick={() => void runInstall(true)}>
              {zh ? '預覽 dry-run' : 'Dry-run preview'}
            </Button>
            <Button disabled={busy || !canMutate} onClick={() => void runInstall(false)}>
              {zh ? '執行安裝' : 'Install now'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack-wizard__uninstall">
          <Alert variant="info">
            {zh
              ? '移除範圍：勾選套餐；若全部不勾 = 移除 manifest 內全部組件。預設保留資料。'
              : 'Pick bundles to remove. If none selected, removes all tracked components. Default keeps data.'}
          </Alert>
          <div style={{ display: 'grid', gap: 6, margin: '12px 0' }}>
            {ALL_BUNDLE_IDS.map((id) => {
              const b = bundles.find((x) => x.id === id);
              return (
                <label key={id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          <Field label={zh ? '資料策略' : 'Data policy'} htmlFor="stack-data-policy">
            <select
              id="stack-data-policy"
              value={dataPolicy}
              onChange={(e) => setDataPolicy(e.target.value as 'keep' | 'purge')}
            >
              <option value="keep">{zh ? '保留資料 (keep-data)' : 'Keep data'}</option>
              <option value="purge">{zh ? '清除資料 (purge-data) ⚠' : 'Purge data ⚠'}</option>
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Button disabled={busy} variant="secondary" onClick={() => void runUninstall(true)}>
              {zh ? '預覽 dry-run' : 'Dry-run preview'}
            </Button>
            <Button
              disabled={busy || !canMutate}
              variant="danger"
              onClick={() => void runUninstall(false)}
            >
              {zh ? '執行移除' : 'Uninstall now'}
            </Button>
          </div>
        </div>
      )}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {result ? (
        <div style={{ marginTop: 16 }}>
          <OpsResultPanel result={result as OpsResultLike} />
          {result.steps?.length ? (
            <ul style={{ fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
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
