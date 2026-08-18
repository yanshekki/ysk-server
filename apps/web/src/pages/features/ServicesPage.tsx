/**
 * Host service matrix — professional ops console.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import {
  PageGuide,
  Alert,
  Badge,
  Button,
  FeaturePageLayout,
  Field,
  LoadingBlock,
  OpsResultPanel,
  PageTabs,
  ConfirmDialog,
  buttonClassName } from '../../shared/components/ui';
import type { ConfirmSeverity } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { dbClusterApi } from '../../features/db-service/cluster-api';
import { consoleApi } from '../../features/db-service/console-api';
import { StackWizard } from '../../features/software/StackWizard';
import { useCapabilities } from '../../shared/hooks/useCapabilities';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { bindSet, bindInput, bindCall2 } from '../bind-handlers';

export function enabledLabel(v: string, t: TFunction): string {
  if (v === 'enabled') return t('services.enabledBoot');
  if (v === 'disabled') return t('common.no');
  if (v === 'not-found') return t('services.bootNa');
  if (v === 'n/a' || v === 'na') return t('services.unitNa');
  if (v === 'static') return t('services.unitStatic');
  if (v === 'indirect') return t('services.unitIndirect');
  if (v === 'alias') return t('services.bootNa');
  return v || t('common.noneSelectedShort');
}

export function actionLabel(
  action: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable',
  t: TFunction,
): string {
  return t(`services.action.${action}`);
}

export function lifecycleDangerForUnit(unit: string): 'normal' | 'edge' | 'sshd' | 'panel' {
  const u = unit.trim().toLowerCase();
  if (u === 'sshd' || u === 'ssh' || u.startsWith('sshd@')) return 'sshd';
  if (u === 'ysk-server' || u.startsWith('ysk-server')) return 'panel';
  if (u === 'nginx' || u === 'apache2' || u === 'httpd') return 'edge';
  return 'normal';
}

/** sshd installed but not enabled on boot — reboot drops the SSH rescue path. */
export function sshdNeedsBootEnable(row: {
  unit: string;
  installed: boolean;
  enabled: string;
}): boolean {
  if (!row.installed) return false;
  if (lifecycleDangerForUnit(row.unit) !== 'sshd') return false;
  return row.enabled !== 'enabled';
}

export function isRedisServiceRow(row: { id?: string; unit?: string; label?: string }): boolean {
  const id = String(row.id ?? '').toLowerCase();
  const unit = String(row.unit ?? '').toLowerCase();
  const label = String(row.label ?? '').toLowerCase();
  return id === 'redis' || unit.startsWith('redis') || label === 'redis';
}

/** Live Redis console: protected-mode on + empty/unread requirepass. */
export function redisConsoleLooksInsecure(
  categories:
    | Array<{ settings?: Array<{ key: string; liveValue?: string | null }> }>
    | null
    | undefined,
): boolean {
  if (!categories?.length) return false;
  let pm = '';
  let sawPass = false;
  let pass: string | null | undefined;
  for (const cat of categories) {
    for (const s of cat.settings ?? []) {
      if (s.key === 'protected-mode') {
        pm = String(s.liveValue ?? '').trim().toLowerCase();
      }
      if (s.key === 'requirepass') {
        sawPass = true;
        pass = s.liveValue;
      }
    }
  }
  if (!(pm === 'yes' || pm === 'on' || pm === '1' || pm === 'true')) return false;
  if (!sawPass || pass == null) return true;
  return !String(pass).trim();
}

type MatrixItem = {
  id: string;
  label: string;
  unit: string;
  href?: string;
  category: string;
  installed: boolean;
  active: string;
  enabled: string;
  activeLabel: string;
};

export function localizeServiceActive(
  active: string | undefined,
  t: TFunction,
  fallback?: string,
): string {
  const a = String(active || '').trim();
  if (!a) return fallback || '—';
  const key = `services.active.${a}`;
  const out = t(key);
  return out === key ? fallback || a : out;
}

export function toneFor(active: string, installed: boolean): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (active === 'active' || active === 'tool') return 'ok';
  if (!installed || active === 'not-found') return 'danger';
  if (active === 'failed') return 'danger';
  if (active === 'inactive') return 'warn';
  return 'neutral';
}

export function ServicesPage() {
  const { t } = useTranslation();
  const { can } = useCapabilities();
  const [items, setItems] = useState<MatrixItem[]>([]);
  const [meta, setMeta] = useState<{
    executeEnabled?: boolean;
    isRoot?: boolean;
    probedAt?: string;
  }>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = usePageTab(['matrix', 'stack', 'about'] as const, 'matrix', {
    aliases: { packages: 'stack', software: 'stack', plans: 'stack' },
  });
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'failed' | 'running' | 'missing'>(
    'all',
  );
  const [q, setQ] = useState('');
  const [haOverview, setHaOverview] = useState<{
    count: number;
    items: Array<{ name: string; engine: string; status: string; id: string }>;
  } | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();
  const [pendingLc, setPendingLc] = useState<{
    unit: string;
    label: string;
    action: 'stop' | 'restart';
  } | null>(null);
  const [redisInsecure, setRedisInsecure] = useState(false);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await systemApi.servicesMatrix();
      setItems(r.items ?? []);
      setMeta({
        executeEnabled: r.executeEnabled,
        isRoot: r.isRoot,
        probedAt: r.probedAt });
      try {
        const ha = await dbClusterApi.overview();
        setHaOverview({
          count: ha.count,
          items: (ha.items ?? []).map((x) => ({
            id: x.id,
            name: x.name,
            engine: x.engine,
            status: x.status })) });
      } catch {
        setHaOverview(null);
      }
      const redis = (r.items ?? []).find((i) => isRedisServiceRow(i));
      if (!redis?.installed || redis.active === 'not-found') {
        setRedisInsecure(false);
      } else {
        try {
          const c = await consoleApi.get('redis');
          setRedisInsecure(redisConsoleLooksInsecure(c.categories));
        } catch {
          setRedisInsecure(false);
        }
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function lifecycle(
    unit: string,
    action: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable',
  ) {
    await run(async () => {
      try {
        const r = await systemApi.serviceLifecycle({ unit, action });
        await refresh();
        return r as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.opFailed');
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, t('services.actionDone', { action: actionLabel(action, t) }));
  }

  const serviceRows = items.filter((i) => i.active !== 'tool' && Boolean(i.unit));
  const running = serviceRows.filter((i) => i.active === 'active').length;
  const missing = items.filter((i) => !i.installed).length;
  const failed = items.filter((i) => i.active === 'failed').length;
  const canMutate = Boolean(
    meta.executeEnabled && meta.isRoot && can('services.control'),
  );
  const sshdRow = items.find((i) => sshdNeedsBootEnable(i));

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category))].sort(),
    [items],
  );

  const filtered = useMemo(() => {
    let list = items;
    if (catFilter !== 'all') list = list.filter((i) => i.category === catFilter);
    if (statusFilter === 'failed') list = list.filter((i) => i.active === 'failed');
    if (statusFilter === 'running') {
      list = list.filter((i) => i.active === 'active' || i.active === 'tool');
    }
    if (statusFilter === 'missing') {
      list = list.filter((i) => !i.installed || i.active === 'not-found');
    }
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (i) =>
          i.label.toLowerCase().includes(needle) ||
          i.unit.toLowerCase().includes(needle) ||
          i.category.toLowerCase().includes(needle),
      );
    }
    return list;
  }, [items, catFilter, statusFilter, q]);

  const heroTone = failed > 0 || missing > 0 ? 'warn' : running > 0 ? 'ok' : 'warn';

  return (
    <FeaturePageLayout
      title={t('nav.services')}
      showCapability={false}
      status={{
        pill: {
          label: t('services.runningOf', { running, total: serviceRows.length }),
          tone: heroTone },
        items: [
          { label: t('common.running'), value: running, tone: 'ok' },
          {
            label: t('common.notInstalled'),
            value: missing,
            tone: missing ? 'warn' : 'neutral' },
          {
            label: t('services.permLabel'),
            value: canMutate
              ? t('services.permCanChange')
              : t('services.permBlocked'),
            tone: canMutate ? 'ok' : 'warn',
            hint: t('services.permHint', {
              exec: meta.executeEnabled ? t('common.on') : t('common.off'),
              root: meta.isRoot ? t('common.yes') : t('common.no'),
            }),
          },
          ...(failed > 0
            ? [{ label: t('common.failed'), value: failed, tone: 'danger' as const }]
            : []),
        ] }}
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            loading={busy || loading}
            onClick={() => {
              setError(null);
              setMsg(null);
              setLoading(true);
              void refresh().finally(() => setLoading(false));
            }}
          >
            {t('common.refresh')}
          </Button>
          <Link to="/system/unit" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('services.controlUnit')}
          </Link>
          <Link to="/logs" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('services.logs')}
          </Link>
        </>
      }
    >
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {sshdRow ? (
        <Alert variant="warn">
          <p className="u-mb-2">{t('services.sshdBootOffWarn')}</p>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!canMutate}
            title={!canMutate ? t('services.lifecycleLocked') : undefined}
            onClick={() => void lifecycle(sshdRow.unit, 'enable')}
          >
            {t('services.action.enable')}
          </Button>
        </Alert>
      ) : null}
      {redisInsecure ? (
        <Alert variant="warn">
          {t('redis.noRequirepass')}{' '}
          <Link to="/databases/redis/service">{t('redis.setRequirepass')}</Link>
        </Alert>
      ) : null}
      {haOverview && haOverview.count > 0 ? (
        <Alert variant="info">
          <strong>{t('services.dbHa')}</strong>：
          {t('services.clusterCount', { count: haOverview.count })} ·{' '}
          {haOverview.items.slice(0, 4).map((x, i) => {
            const st = t(`db.cluster.status.${x.status}`);
            const href =
              x.engine === 'redis'
                ? '/databases/redis/service?tab=cluster'
                : x.engine === 'mysql'
                  ? '/databases/mysql/service?tab=cluster'
                  : x.engine === 'postgres'
                    ? '/databases/postgres/service?tab=cluster'
                    : '/databases/mariadb/service?tab=cluster';
            const engineLabel =
              x.engine === 'redis'
                ? 'Redis'
                : x.engine === 'mysql'
                  ? 'MySQL'
                  : x.engine === 'postgres'
                    ? 'PostgreSQL'
                    : 'MariaDB';
            return (
              <span key={x.id}>
                {i > 0 ? ' · ' : ''}
                <Link to={href}>
                  {x.name}（{engineLabel} · {st === `db.cluster.status.${x.status}` ? x.status : st}）
                </Link>
              </span>
            );
          })}
          {haOverview.count > 4 ? ' …' : ''}
          <span className="muted u-text-sm"> · {t('services.clusterLegend')}</span>
        </Alert>
      ) : null}

      {loading && items.length === 0 ? (
        <LoadingBlock label={t('services.probing')} />
      ) : (
        <div className="ops">
          {!canMutate ? (
            <Alert variant="info">
              {t('services.lifecycleLocked')}{' '}
              <Link to="/system">{t('services.hostSettings')}</Link>。
            </Alert>
          ) : null}

          <PageTabs
            tabs={[
              { id: 'matrix', label: t('services.matrixTab', { count: serviceRows.length }) },
              { id: 'stack', label: t('services.stackTab') },
              { id: 'about', label: t('common.about') },
            ]}
            active={tab}
            onChange={setTab}
            variant="scroll"
          >
            {tab === 'stack' ? (
              <section className="ops-panel" data-testid="services-stack-tab">
                <header className="ops-panel__head">
                  <h2 className="ops-panel__title">
                    {t('services.stackTitle')}
                  </h2>
                  <p className="muted u-mb-0">
                    {t('services.stackHint')}
                  </p>
                </header>
                <StackWizard />
              </section>
            ) : null}
            {tab === 'matrix' ? (
              <section className="ops-panel">
                <header className="ops-panel__head ops-panel__head--stack">
                  <div className="ops-panel__head-row">
                    <div>
                      <h3 className="ops-panel__title">{t('services.knownServices')}</h3>
                      <p className="ops-panel__sub">
                        {t('services.showing', {
                          shown: filtered.length,
                          total: items.length })}
                      </p>
                    </div>
                  </div>
                  <div className="ops-toolbar">
                    <div className="ops-chips">
                      <button
                        type="button"
                        className={`ops-chip${catFilter === 'all' ? ' ops-chip--active' : ''}`}
                        onClick={bindSet(setCatFilter, 'all')}
                      >
                        {t('services.all')}
                        <span className="ops-chip__n">{items.length}</span>
                      </button>
                      {categories.map((c) => {
                        const n = items.filter((i) => i.category === c && i.installed).length;
                        if (n === 0) return null;
                        return (
                          <button
                            key={c}
                            type="button"
                            className={`ops-chip${catFilter === c ? ' ops-chip--active' : ''}`}
                            onClick={bindSet(setCatFilter, c)}
                          >
                            {c}
                            <span className="ops-chip__n">{n}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="ops-chips">
                      {(
                        [
                          ['all', items.length],
                          ['running', running],
                          ['failed', failed],
                          ['missing', missing],
                        ] as const
                      ).map(([id, n]) => (
                        <button
                          key={id}
                          type="button"
                          className={`ops-chip${statusFilter === id ? ' ops-chip--active' : ''}`}
                          onClick={() => setStatusFilter(id)}
                        >
                          {t(`services.statusFilter.${id}`)}
                          <span className="ops-chip__n">{n}</span>
                        </button>
                      ))}
                    </div>
                    <Field label={t('common.search')} htmlFor="svc-q" flush>
                      <input
                        id="svc-q"
                        value={q}
                        onChange={bindInput(setQ)}
                        placeholder={t('services.searchPh')}
                      />
                    </Field>
                  </div>
                </header>

                {filtered.length === 0 ? (
                  <p className="ops-muted">{t('services.noMatch')}</p>
                ) : (
                  <div className="ops-svc-list">
                    {filtered.map((row) => (
                      <article
                        key={row.id}
                        className={`ops-svc ops-svc--${toneFor(row.active, row.installed)}`}
                      >
                        <div className="ops-svc__body">
                          <div className="ops-svc__head">
                            <h4 className="ops-svc__name">{row.label}</h4>
                            <Badge tone={toneFor(row.active, row.installed)}>
                              {row.activeLabel}
                            </Badge>
                            <span className="ops-svc__cat">{row.category}</span>
                          </div>
                          <div className="ops-svc__meta">
                            <code>{row.unit}</code>
                            <span>
                              {t('services.bootPrefix', {
                                state: enabledLabel(row.enabled, t) })}
                            </span>
                            {!row.installed ? (
                              <Badge tone="danger">{t('common.notInstalled')}</Badge>
                            ) : null}
                            {row.installed &&
                            row.active === 'active' &&
                            row.enabled !== 'enabled' ? (
                              <Badge
                                tone="warn"
                                title={t('services.bootDisabledWarn', { label: row.label })}
                              >
                                {t('services.bootDisabledShort')}
                              </Badge>
                            ) : null}
                            {redisInsecure && isRedisServiceRow(row) ? (
                              <Badge tone="danger">{t('redis.insecureShort')}</Badge>
                            ) : null}
                          </div>
                        </div>
                        <div className="ops-svc__actions">
                          {!row.installed ? (
                            row.href ? (
                              <Link
                                to={row.href}
                                className={buttonClassName({ variant: 'primary', size: 'sm' })}
                              >
                                {t('services.installOrOpen')}
                              </Link>
                            ) : (
                              <Badge tone="danger">{t('common.notInstalled')}</Badge>
                            )
                          ) : row.active === 'tool' || row.unit === '—' || !row.unit ? (
                            row.href ? (
                              <Link
                                to={row.href}
                                className={buttonClassName({ variant: 'primary', size: 'sm' })}
                              >
                                {t('services.manageRuntime')}
                              </Link>
                            ) : null
                          ) : (
                            <>
                              <Button
                                variant="primary"
                                size="sm"
                                loading={busy}
                                disabled={
                                  !canMutate ||
                                  !row.installed ||
                                  row.active === 'active'
                                }
                                title={
                                  !row.installed
                                    ? t('common.notInstalled')
                                    : row.active === 'active'
                                      ? t('common.running')
                                      : undefined
                                }
                                onClick={bindCall2(lifecycle, row.unit, 'start')}
                              >
                                {t('services.action.start')}
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={busy}
                                disabled={!canMutate || !row.installed}
                                title={!row.installed ? t('common.notInstalled') : undefined}
                                onClick={() =>
                                  setPendingLc({
                                    unit: row.unit,
                                    label: row.label,
                                    action: 'restart',
                                  })
                                }
                              >
                                {t('services.action.restart')}
                              </Button>
                              {row.active === 'active' && row.enabled !== 'enabled' ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  loading={busy}
                                  disabled={!canMutate || !row.installed}
                                  title={t('services.bootDisabledWarn', { label: row.label })}
                                  onClick={bindCall2(lifecycle, row.unit, 'enable')}
                                >
                                  {t('services.action.enable')}
                                </Button>
                              ) : null}
                              <Button
                                variant="danger"
                                size="sm"
                                loading={busy}
                                disabled={!canMutate || !row.installed}
                                title={
                                  !row.installed
                                    ? t('common.notInstalled')
                                    : lifecycleDangerForUnit(row.unit) === 'panel' ||
                                        lifecycleDangerForUnit(row.unit) === 'sshd'
                                      ? t('services.stopNeedConfirmPhrase')
                                      : t('services.stopNeedConfirmImpact', { label: row.label })
                                }
                                onClick={() =>
                                  setPendingLc({
                                    unit: row.unit,
                                    label: row.label,
                                    action: 'stop',
                                  })
                                }
                              >
                                {t('services.action.stop')}
                              </Button>
                              {row.href ? (
                                <Link
                                  to={row.href}
                                  className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                                >
                                  {t('services.controlPage')}
                                </Link>
                              ) : null}
                              <Link
                                to={`/logs?unit=${encodeURIComponent(row.unit)}`}
                                className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                              >
                                {t('services.logs')}
                              </Link>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {tab === 'about' ? <PageGuide guideId="services" /> : null}
          </PageTabs>

          <OpsResultPanel
            title={t('opsResult.title')}
            result={result}
            message={msg}
            busy={busy}
          />
        </div>
      )}

      <ConfirmDialog
        open={pendingLc != null}
        onClose={() => !busy && setPendingLc(null)}
        onConfirm={() => {
          const p = pendingLc;
          setPendingLc(null);
          if (p) void lifecycle(p.unit, p.action);
        }}
        title={
          pendingLc
            ? lifecycleDangerForUnit(pendingLc.unit) === 'sshd'
              ? t('services.stopConfirmSshdTitle')
              : lifecycleDangerForUnit(pendingLc.unit) === 'panel'
                ? t('services.stopConfirmPanelTitle')
                : t('services.stopConfirmTitle', { label: pendingLc.label })
            : ''
        }
        description={
          pendingLc
            ? lifecycleDangerForUnit(pendingLc.unit) === 'sshd'
              ? t('services.stopConfirmSshdDesc')
              : lifecycleDangerForUnit(pendingLc.unit) === 'panel'
                ? t('services.stopConfirmPanelDesc')
                : lifecycleDangerForUnit(pendingLc.unit) === 'edge'
                  ? t('services.stopConfirmEdgeDesc', { label: pendingLc.label })
                  : t('services.stopConfirmDesc', { label: pendingLc.label })
            : ''
        }
        consequences={
          pendingLc && lifecycleDangerForUnit(pendingLc.unit) === 'sshd'
            ? [t('services.stopConfirmSshdConsequence')]
            : pendingLc && lifecycleDangerForUnit(pendingLc.unit) === 'panel'
              ? [t('services.stopConfirmPanelConsequence')]
              : pendingLc && lifecycleDangerForUnit(pendingLc.unit) === 'edge'
                ? [t('services.stopConfirmEdgeConsequence', { label: pendingLc.label })]
                : undefined
        }
        confirmText={
          pendingLc && lifecycleDangerForUnit(pendingLc.unit) === 'sshd'
            ? t('services.stopConfirmSshdToken')
            : pendingLc && lifecycleDangerForUnit(pendingLc.unit) === 'panel'
              ? t('services.stopConfirmPanelToken')
              : undefined
        }
        severity={
          (pendingLc
            ? lifecycleDangerForUnit(pendingLc.unit) === 'sshd' ||
              lifecycleDangerForUnit(pendingLc.unit) === 'panel'
              ? 'critical'
              : lifecycleDangerForUnit(pendingLc.unit) === 'edge'
                ? 'destructive'
                : 'standard'
            : 'standard') as ConfirmSeverity
        }
        confirmLabel={
          pendingLc?.action === 'restart'
            ? t('services.action.restart')
            : t('services.action.stop')
        }
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
