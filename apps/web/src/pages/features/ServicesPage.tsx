/**
 * Host service matrix — professional ops console.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

function enabledLabel(v: string): string {
  if (v === 'enabled') return '自啟';
  if (v === 'disabled') return '否';
  if (v === 'static' || v === 'indirect') return v;
  return v || '—';
}

function actionLabel(action: 'start' | 'stop' | 'restart' | 'reload'): string {
  if (action === 'start') return '啟動';
  if (action === 'stop') return '停止';
  if (action === 'restart') return '重啟';
  return '重載';
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

function toneFor(active: string, installed: boolean): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (active === 'active') return 'ok';
  if (!installed || active === 'not-found') return 'danger';
  if (active === 'failed') return 'danger';
  if (active === 'inactive') return 'warn';
  return 'neutral';
}

export function ServicesPage() {
  const { t } = useTranslation();
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
      setLoadError(e instanceof Error ? e.message : '載入失敗');
    }
  }, []);

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
        const m = e instanceof Error ? e.message : '操作失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, `已${actionLabel(action)}`);
  }

  const running = items.filter((i) => i.active === 'active').length;
  const missing = items.filter((i) => !i.installed).length;
  const failed = items.filter((i) => i.active === 'failed').length;
  const canMutate = Boolean(meta.executeEnabled && meta.isRoot);

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
      title={t('nav.services', { defaultValue: '服務狀態' })}
      showCapability={false}
      status={{
        pill: {
          label: `${running}/${items.length} 運行中`,
          tone: heroTone,
        },
        items: [
          { label: '運行中', value: running, tone: 'ok' },
          {
            label: '未安裝',
            value: missing,
            tone: missing ? 'warn' : 'neutral',
          },
          {
            label: 'EXECUTE',
            value: meta.executeEnabled ? '開' : '關',
            tone: meta.executeEnabled ? 'ok' : 'warn',
          },
          {
            label: 'Root',
            value: meta.isRoot ? '是' : '否',
            tone: meta.isRoot ? 'ok' : 'warn',
          },
          {
            label: '可變更',
            value: canMutate ? '是' : '鎖定',
            tone: canMutate ? 'ok' : 'warn',
          },
          ...(failed > 0
            ? [{ label: '失敗', value: failed, tone: 'danger' as const }]
            : []),
        ],
      }}
      actions={<>
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
            重新整理
          </Button>
          <Link to="/system/unit" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            控制面 unit
          </Link>
          <Link to="/logs" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            日誌
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
            關閉
          </Button>
        </Alert>
      ) : null}

      {haOverview && haOverview.count > 0 ? (
        <Alert variant="info">
          <strong>資料庫 HA</strong>：{haOverview.count} 個叢集 ·{' '}
          {haOverview.items
            .slice(0, 4)
            .map((x) => `${x.name}(${x.status})`)
            .join(' · ')}
          {haOverview.count > 4 ? ' …' : ''}{' '}
          <Link to="/databases/mariadb/service" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            MariaDB 叢集
          </Link>{' '}
          <Link to="/databases/mysql/service" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            MySQL
          </Link>
        </Alert>
      ) : null}

      {loading && items.length === 0 ? (
        <LoadingBlock label="探測服務矩陣…" />
      ) : (
        <div className="ops">
          {!canMutate ? (
            <Alert variant="info">
              生命週期操作已鎖定：需 root + YSK_EXECUTE。探測仍可用。見{' '}
              <Link to="/system">主機設定</Link>。
            </Alert>
          ) : null}

          <PageTabs
            tabs={[
              { id: 'matrix', label: `服務矩陣 (${items.length})` },
              { id: 'protection', label: '保護探測' },
            
          { id: 'about', label: '說明' },
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
                      <h3 className="ops-panel__title">已知服務</h3>
                      <p className="ops-panel__sub">
                        顯示 {filtered.length} / {items.length}
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
                        全部
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
                    <Field label="搜尋" htmlFor="svc-q" flush>
                      <input
                        id="svc-q"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="名稱 / unit / 類別"
                      />
                    </Field>
                  </div>
                </header>

                {filtered.length === 0 ? (
                  <p className="ops-muted">沒有符合的服務</p>
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
                            <span>開機 {enabledLabel(row.enabled)}</span>
                            {!row.installed ? (
                              <Badge tone="danger">未安裝</Badge>
                            ) : null}
                          </div>
                        </div>
                        <div className="ops-svc__actions">
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            disabled={
                              (!row.installed && row.active !== 'active') ||
                              !canMutate
                            }
                            onClick={() => void lifecycle(row.unit, 'start')}
                          >
                            啟動
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            disabled={!canMutate}
                            onClick={() => void lifecycle(row.unit, 'restart')}
                          >
                            重啟
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy}
                            disabled={!canMutate}
                            onClick={() => void lifecycle(row.unit, 'stop')}
                          >
                            停止
                          </Button>
                          {row.href ? (
                            <Link
                              to={row.href}
                              className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                            >
                              控制頁
                            </Link>
                          ) : null}
                          <Link
                            to={`/logs?unit=${encodeURIComponent(row.unit)}`}
                            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                          >
                            日誌
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
                    <h3 className="ops-panel__title">保護探測</h3>
                    <p className="ops-panel__sub">
                      唯讀；唔改防火牆／fail2ban
                    </p>
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
                          notes: ['保護探測完成'],
                          ...r,
                        } as unknown as OpsResultLike;
                      }, '探測完成')
                    }
                  >
                    執行保護探測
                  </Button>
                  <Link to="/fail2ban" className={buttonClassName({ variant: 'secondary', size: 'md' })}>
                    Fail2ban
                  </Link>
                  <Link to="/firewall" className={buttonClassName({ variant: 'ghost', size: 'md' })}>
                    防火牆
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
                  <p className="ops-muted">尚未探測</p>
                )}
              </section>
            ) : null}
          
        {tab === 'about' ? <PageGuide guideId="services" /> : null}
      </PageTabs>

          <OpsResultPanel
            title="操作結果"
            result={result}
            message={msg}
            busy={busy}
          />
        </div>
      )}
    </FeaturePageLayout>
  );
}
