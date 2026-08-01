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
  buttonClassName,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { dbClusterApi } from '../../features/db-service/cluster-api';
import { useCapabilities } from '../../shared/hooks/useCapabilities';

export function enabledLabel(v: string, t: TFunction): string {
  if (v === 'enabled') return t('services.enabledBoot');
  if (v === 'disabled') return t('common.no');
  if (v === 'static' || v === 'indirect') return v;
  return v || t('common.noneSelectedShort');
}

export function actionLabel(
  action: 'start' | 'stop' | 'restart' | 'reload',
  t: TFunction,
): string {
  return t(`services.action.${action}`);
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

export function toneFor(active: string, installed: boolean): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (active === 'active') return 'ok';
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
  const [tab, setTab] = useState('matrix');
  const [catFilter, setCatFilter] = useState('all');
  const [q, setQ] = useState('');
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const [haOverview, setHaOverview] = useState<{
    count: number;
    items: Array<{ name: string; engine: string; status: string; id: string }>;
  } | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await systemApi.servicesMatrix();
      setItems(r.items ?? []);
      setMeta({
        executeEnabled: r.executeEnabled,
        isRoot: r.isRoot,
        probedAt: r.probedAt,
      });
      try {
        const ha = await dbClusterApi.overview();
        setHaOverview({
          count: ha.count,
          items: (ha.items ?? []).map((x) => ({
            id: x.id,
            name: x.name,
            engine: x.engine,
            status: x.status,
          })),
        });
      } catch {
        setHaOverview(null);
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
    action: 'start' | 'stop' | 'restart' | 'reload',
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

  const running = items.filter((i) => i.active === 'active').length;
  const missing = items.filter((i) => !i.installed).length;
  const failed = items.filter((i) => i.active === 'failed').length;
  const canMutate = Boolean(
    meta.executeEnabled && meta.isRoot && can('services.control'),
  );

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category))].sort(),
    [items],
  );

  const filtered = useMemo(() => {
    let list = items;
    if (catFilter !== 'all') list = list.filter((i) => i.category === catFilter);
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
  }, [items, catFilter, q]);

  const heroTone = failed > 0 || missing > 0 ? 'warn' : running > 0 ? 'ok' : 'warn';

  return (
    <FeaturePageLayout
      title={t('nav.services')}
      showCapability={false}
      status={{
        pill: {
          label: t('services.runningOf', { running, total: items.length }),
          tone: heroTone,
        },
        items: [
          { label: t('common.running'), value: running, tone: 'ok' },
          {
            label: t('common.notInstalled'),
            value: missing,
            tone: missing ? 'warn' : 'neutral',
          },
          {
            label: 'EXECUTE',
            value: meta.executeEnabled ? t('common.on') : t('common.off'),
            tone: meta.executeEnabled ? 'ok' : 'warn',
          },
          {
            label: 'Root',
            value: meta.isRoot ? t('common.yes') : t('common.no'),
            tone: meta.isRoot ? 'ok' : 'warn',
          },
          {
            label: t('services.canMutate'),
            value: canMutate ? t('common.yes') : t('services.locked'),
            tone: canMutate ? 'ok' : 'warn',
          },
          ...(failed > 0
            ? [{ label: t('common.failed'), value: failed, tone: 'danger' as const }]
            : []),
        ],
      }}
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
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}

      {haOverview && haOverview.count > 0 ? (
        <Alert variant="info">
          <strong>{t('services.dbHa')}</strong>：
          {t('services.clusterCount', { count: haOverview.count })} ·{' '}
          {haOverview.items
            .slice(0, 4)
            .map((x) => `${x.name}(${x.status})`)
            .join(' · ')}
          {haOverview.count > 4 ? ' …' : ''}{' '}
          <Link
            to="/databases/mariadb/service"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
          >
            {t('services.mariadbCluster')}
          </Link>{' '}
          <Link
            to="/databases/mysql/service"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
          >
            MySQL
          </Link>
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
              { id: 'matrix', label: t('services.matrixTab', { count: items.length }) },
              { id: 'protection', label: t('services.protectionTab') },
              { id: 'about', label: t('common.about') },
            ]}
            active={tab}
            onChange={setTab}
            variant="scroll"
          >
            {tab === 'matrix' ? (
              <section className="ops-panel">
                <header className="ops-panel__head ops-panel__head--stack">
                  <div className="ops-panel__head-row">
                    <div>
                      <h3 className="ops-panel__title">{t('services.knownServices')}</h3>
                      <p className="ops-panel__sub">
                        {t('services.showing', {
                          shown: filtered.length,
                          total: items.length,
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="ops-toolbar">
                    <div className="ops-chips">
                      <button
                        type="button"
                        className={`ops-chip${catFilter === 'all' ? ' ops-chip--active' : ''}`}
                        onClick={() => setCatFilter('all')}
                      >
                        {t('services.all')}
                        <span className="ops-chip__n">{items.length}</span>
                      </button>
                      {categories.map((c) => {
                        const n = items.filter((i) => i.category === c).length;
                        return (
                          <button
                            key={c}
                            type="button"
                            className={`ops-chip${catFilter === c ? ' ops-chip--active' : ''}`}
                            onClick={() => setCatFilter(c)}
                          >
                            {c}
                            <span className="ops-chip__n">{n}</span>
                          </button>
                        );
                      })}
                    </div>
                    <Field label={t('common.search')} htmlFor="svc-q" flush>
                      <input
                        id="svc-q"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
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
                                state: enabledLabel(row.enabled, t),
                              })}
                            </span>
                            {!row.installed ? (
                              <Badge tone="danger">{t('common.notInstalled')}</Badge>
                            ) : null}
                          </div>
                        </div>
                        <div className="ops-svc__actions">
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            disabled={
                              (!row.installed && row.active !== 'active') || !canMutate
                            }
                            onClick={() => void lifecycle(row.unit, 'start')}
                          >
                            {t('services.action.start')}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            disabled={!canMutate}
                            onClick={() => void lifecycle(row.unit, 'restart')}
                          >
                            {t('services.action.restart')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy}
                            disabled={!canMutate}
                            onClick={() => void lifecycle(row.unit, 'stop')}
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
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {tab === 'protection' ? (
              <section className="ops-panel">
                <header className="ops-panel__head">
                  <div>
                    <h3 className="ops-panel__title">{t('services.protectionTitle')}</h3>
                    <p className="ops-panel__sub">{t('services.protectionSub')}</p>
                  </div>
                </header>
                <div className="ops-panel__actions">
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = (await systemApi.protectionProbe()) as Record<
                          string,
                          unknown
                        >;
                        setProbe(r);
                        return {
                          ok: true,
                          notes: [t('services.protectionDoneNote')],
                          ...r,
                        } as unknown as OpsResultLike;
                      }, t('services.probeDone'))
                    }
                  >
                    {t('services.runProtection')}
                  </Button>
                  <Link
                    to="/protection"
                    className={buttonClassName({ variant: 'secondary', size: 'md' })}
                  >
                    {t('nav.protection')}
                  </Link>
                </div>
                {probe ? (
                  <dl className="ops-dl">
                    {Object.entries(probe)
                      .filter(([, v]) => v == null || typeof v !== 'object')
                      .slice(0, 24)
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{String(v)}</dd>
                        </div>
                      ))}
                  </dl>
                ) : (
                  <p className="ops-muted">{t('services.notProbedYet')}</p>
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
    </FeaturePageLayout>
  );
}
