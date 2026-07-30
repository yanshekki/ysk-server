/**
 * Production readiness — tabbed ops console (honest gate).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  FeaturePageLayout,
  LoadingBlock,
  PageTabs,

  buttonClassName,} from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import type {
  ProductionReadinessDto,
  ReadinessItemDto,
  ReadinessLevel,
} from '../../features/system/api';
import { usePageTab } from '../../shared/hooks/usePageTab';

const RDY_TABS = ['priority', 'checklist', 'summary'] as const;

const CAT_LABEL: Record<string, string> = {
  core: '控制面',
  security: '權限與安全',
  binaries: '系統軟體',
  hosting: '執行環境',
  dns: 'DNS',
  email: '郵件',
  isolation: '專案隔離',
  ops: '運維',
};

type LevelFilter = 'all' | 'blockers' | 'missing' | 'degraded' | 'ready';

function levelTone(level: ReadinessLevel): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (level === 'ready') return 'ok';
  if (level === 'degraded') return 'warn';
  if (level === 'missing') return 'danger';
  return 'neutral';
}

function levelLabel(level: ReadinessLevel): string {
  if (level === 'ready') return '就緒';
  if (level === 'degraded') return '降級';
  if (level === 'missing') return '缺少';
  return '未知';
}

function severityLabel(s?: string): string | null {
  if (s === 'critical') return '關鍵';
  if (s === 'recommended') return '建議';
  if (s === 'optional') return '可選';
  return null;
}

function ItemRow({
  item,
  index,
  emphasize,
}: {
  item: ReadinessItemDto;
  index?: number;
  emphasize?: boolean;
}) {
  const sev = severityLabel(item.severity);
  return (
    <article
      className={`rdy-item rdy-item--${item.level}${emphasize ? ' rdy-item--emphasis' : ''}`}
    >
      <div className={`rdy-item__status rdy-item__status--${item.level}`} aria-hidden>
        {item.level === 'ready' ? '✓' : item.level === 'missing' ? '!' : item.level === 'degraded' ? '⚠' : '·'}
      </div>
      <div className="rdy-item__body">
        <div className="rdy-item__head">
          {typeof index === 'number' ? (
            <span className="rdy-item__step">{index + 1}</span>
          ) : null}
          <h3 className="rdy-item__title">{item.title}</h3>
          <Badge tone={levelTone(item.level)}>{levelLabel(item.level)}</Badge>
          {sev ? <span className="rdy-item__sev">{sev}</span> : null}
        </div>
        <p className="rdy-item__detail">{item.detail}</p>
        {item.fixHint && item.level !== 'ready' ? (
          <p className="rdy-item__hint">{item.fixHint}</p>
        ) : null}
        <div className="rdy-item__meta">
          <code className="rdy-item__id">{item.id}</code>
          {item.spec ? <span className="rdy-item__spec">{item.spec}</span> : null}
        </div>
      </div>
      <div className="rdy-item__action">
        {item.fixHref && item.level !== 'ready' ? (
          <Link
            to={item.fixHref}
            className={`btn btn--sm ${emphasize || item.level === 'missing' ? 'btn--primary' : 'btn--secondary'}`}
          >
            修復
          </Link>
        ) : item.level === 'ready' ? (
          <span className="rdy-item__ok">通過</span>
        ) : (
          <span className="rdy-item__na">—</span>
        )}
      </div>
    </article>
  );
}

export function ReadinessPage() {
  const { t } = useTranslation();
  const [report, setReport] = useState<ProductionReadinessDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [q, setQ] = useState('');
  const [tab, setTab] = usePageTab(RDY_TABS, 'priority');

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await systemApi.readiness();
      setReport(r);
      if (!r.productionReady && (r.blockers?.length || r.score.missing > 0)) {
        setFilter((prev) => (prev === 'ready' ? 'blockers' : prev === 'all' ? 'blockers' : prev));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '就緒檢查失敗');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const blockers = useMemo(() => {
    if (!report) return [];
    if (report.blockers?.length) return report.blockers;
    return report.items.filter(
      (i) =>
        i.level === 'missing' ||
        (i.severity === 'critical' && i.level !== 'ready') ||
        ((i.id === 'execute-policy' || i.id === 'root') && i.level !== 'ready'),
    );
  }, [report]);

  const categories = useMemo(() => {
    if (!report) return [];
    if (report.categories?.length) return report.categories;
    return [...new Set(report.items.map((i) => i.category))];
  }, [report]);

  const filtered = useMemo(() => {
    if (!report) return [];
    let list: ReadinessItemDto[] =
      filter === 'blockers'
        ? blockers
        : filter === 'all'
          ? report.items
          : report.items.filter((i) => i.level === filter);
    if (catFilter !== 'all') list = list.filter((i) => i.category === catFilter);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(needle) ||
          i.detail.toLowerCase().includes(needle) ||
          i.id.toLowerCase().includes(needle) ||
          (i.fixHint ?? '').toLowerCase().includes(needle),
      );
    }
    return list;
  }, [report, filter, catFilter, q, blockers]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReadinessItemDto[]>();
    for (const item of filtered) {
      const arr = map.get(item.category) ?? [];
      arr.push(item);
      map.set(item.category, arr);
    }
    const order = categories.length ? categories : [...map.keys()];
    const out: Array<{ cat: string; items: ReadinessItemDto[] }> = [];
    for (const c of order) {
      const items = map.get(c);
      if (items?.length) out.push({ cat: c, items });
    }
    for (const [c, items] of map) {
      if (!order.includes(c) && items.length) out.push({ cat: c, items });
    }
    return out;
  }, [filtered, categories]);

  const scorePct = useMemo(() => {
    if (!report?.score.total) return 0;
    return Math.round((report.score.ready / report.score.total) * 100);
  }, [report]);

  const heroTone = report?.productionReady
    ? 'ok'
    : blockers.length
      ? 'danger'
      : 'warn';

  function downloadReport() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json; charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ysk-readiness-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const score = report?.score;
  const firstFix = blockers.find((b) => b.fixHref);

  return (
    <FeaturePageLayout
      title={t('nav.readiness', { defaultValue: '就緒探測' })}
      showCapability={false}
      status={
        report
          ? {
              pill: {
                label: report.productionReady
                  ? `門檻通過 · ${scorePct}%`
                  : `尚未達標 · ${scorePct}%`,
                tone: heroTone,
              },
              items: [
                {
                  label: 'EXECUTE',
                  value: report.executeEnabled ? '已開' : '未開',
                  tone: report.executeEnabled ? 'ok' : 'warn',
                },
                {
                  label: 'Root',
                  value: report.isRoot ? '是' : '否',
                  tone: report.isRoot ? 'ok' : 'warn',
                },
                { label: '就緒', value: score?.ready ?? 0, tone: 'ok' },
                {
                  label: '降級',
                  value: score?.degraded ?? 0,
                  tone: (score?.degraded ?? 0) > 0 ? 'warn' : 'neutral',
                },
                {
                  label: '缺少',
                  value: score?.missing ?? 0,
                  tone: (score?.missing ?? 0) > 0 ? 'danger' : 'neutral',
                },
                {
                  label: '阻擋',
                  value: blockers.length,
                  tone: blockers.length ? 'danger' : 'ok',
                },
              ],
            }
          : undefined
      }
      actions={<>
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void load()}>
            {busy ? '探測中…' : '重新探測'}
          </Button>
          <Button variant="ghost" size="sm" disabled={!report} onClick={() => downloadReport()}>
            匯出報告
          </Button>
          {firstFix ? (
            <Link to={firstFix.fixHref!} className={buttonClassName({ variant: 'primary', size: 'sm' })}>
              處理首個阻擋
            </Link>
          ) : report && !report.productionReady ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setFilter('degraded');
                setTab('checklist');
              }}
            >
              檢視建議項
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {busy && !report ? <LoadingBlock label="正在探測主機能力…" /> : null}

      {report ? (
        <div className="rdy">
          <PageTabs
            tabs={[
              {
                id: 'priority',
                label: '優先修復',
                badge: blockers.length || undefined,
              },
              {
                id: 'checklist',
                label: '完整清單',
                badge: report.items.length || undefined,
              },
              { id: 'summary', label: '摘要與快捷' },
            ]}
            active={tab}
            onChange={setTab}
            variant="scroll"
          >
            {tab === 'priority' ? (
              <div className="tab-panel">
                <section
                  className="rdy-panel rdy-panel--primary"
                  aria-labelledby="rdy-next-title"
                >
                  <header className="rdy-panel__head">
                    <div>
                      <h2 id="rdy-next-title" className="rdy-panel__title">
                        優先修復
                      </h2>
                      <p className="rdy-panel__sub">
                        按建議順序處理；修好阻擋後再重新探測
                      </p>
                    </div>
                    {blockers.length > 0 ? (
                      <Badge tone="danger">{blockers.length} 項</Badge>
                    ) : (
                      <Badge tone="ok">無硬阻擋</Badge>
                    )}
                  </header>

                  {blockers.length === 0 ? (
                    <div className="rdy-empty rdy-empty--ok">
                      <strong>沒有硬阻擋項</strong>
                      <p>
                        生產門檻
                        {report.productionReady ? '已通過' : '仍可能因權限未達標'}。
                        可檢視「降級」建議項（郵件、DNS、可選 runtime）。
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setFilter('degraded');
                          setTab('checklist');
                        }}
                      >
                        查看降級項
                      </Button>
                    </div>
                  ) : (
                    <div className="rdy-item-list">
                      {blockers.map((item, i) => (
                        <ItemRow key={item.id} item={item} index={i} emphasize />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}

            {tab === 'checklist' ? (
              <div className="tab-panel">
                <section className="rdy-panel rdy-panel--checklist" id="rdy-checklist">
                  <header className="rdy-panel__head rdy-panel__head--stack">
                    <div className="rdy-panel__head-row">
                      <div>
                        <h2 className="rdy-panel__title">完整檢查清單</h2>
                        <p className="rdy-panel__sub">
                          顯示 {filtered.length} / {report.items.length} 項
                          {catFilter !== 'all'
                            ? ` · ${CAT_LABEL[catFilter] ?? catFilter}`
                            : ''}
                        </p>
                      </div>
                    </div>

                    <div className="rdy-toolbar">
                      <div className="rdy-chips" role="tablist" aria-label="狀態篩選">
                        {(
                          [
                            ['all', `全部`, report.items.length],
                            ['blockers', `阻擋`, blockers.length],
                            ['missing', `缺少`, score?.missing ?? 0],
                            ['degraded', `降級`, score?.degraded ?? 0],
                            ['ready', `就緒`, score?.ready ?? 0],
                          ] as const
                        ).map(([id, label, n]) => (
                          <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={filter === id}
                            className={`rdy-chip${filter === id ? ' rdy-chip--active' : ''}${
                              id === 'missing' || id === 'blockers'
                                ? ' rdy-chip--danger'
                                : id === 'degraded'
                                  ? ' rdy-chip--warn'
                                  : id === 'ready'
                                    ? ' rdy-chip--ok'
                                    : ''
                            }`}
                            onClick={() => setFilter(id)}
                          >
                            {label}
                            <span className="rdy-chip__n">{n}</span>
                          </button>
                        ))}
                      </div>

                      <div className="rdy-toolbar__filters">
                        <label className="rdy-field">
                          <span className="rdy-field__lab">類別</span>
                          <select
                            value={catFilter}
                            onChange={(e) => setCatFilter(e.target.value)}
                          >
                            <option value="all">全部類別</option>
                            {categories.map((c) => (
                              <option key={c} value={c}>
                                {CAT_LABEL[c] ?? c}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="rdy-field rdy-field--grow">
                          <span className="rdy-field__lab">搜尋</span>
                          <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="標題、說明、id、修復提示…"
                            autoComplete="off"
                          />
                        </label>
                      </div>

                      {categories.length > 1 ? (
                        <div className="rdy-cat-pills" aria-label="快速類別">
                          <button
                            type="button"
                            className={`rdy-pill${catFilter === 'all' ? ' rdy-pill--active' : ''}`}
                            onClick={() => setCatFilter('all')}
                          >
                            全部
                          </button>
                          {categories.map((c) => {
                            const count = report.items.filter(
                              (i) => i.category === c,
                            ).length;
                            const bad = report.items.filter(
                              (i) =>
                                i.category === c &&
                                (i.level === 'missing' || i.level === 'degraded'),
                            ).length;
                            return (
                              <button
                                key={c}
                                type="button"
                                className={`rdy-pill${catFilter === c ? ' rdy-pill--active' : ''}${
                                  bad > 0 ? ' rdy-pill--issue' : ''
                                }`}
                                onClick={() => setCatFilter(c)}
                              >
                                {CAT_LABEL[c] ?? c}
                                <span className="rdy-pill__n">{count}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </header>

                  {grouped.length === 0 ? (
                    <div className="rdy-empty">
                      <strong>沒有符合的項目</strong>
                      <p>試下清搜尋或改篩選條件。</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setFilter('all');
                          setCatFilter('all');
                          setQ('');
                        }}
                      >
                        重設篩選
                      </Button>
                    </div>
                  ) : (
                    <div className="rdy-groups">
                      {grouped.map(({ cat, items }) => (
                        <div key={cat} className="rdy-group">
                          <div className="rdy-group__head">
                            <h3 className="rdy-group__title">
                              {CAT_LABEL[cat] ?? cat}
                            </h3>
                            <span className="rdy-group__count">{items.length}</span>
                          </div>
                          <div className="rdy-item-list">
                            {items.map((item) => (
                              <ItemRow key={item.id} item={item} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}

            {tab === 'summary' ? (
              <div className="tab-panel stack">
                <section className="rdy-panel">
                  <header className="rdy-panel__head">
                    <h2 className="rdy-panel__title">摘要</h2>
                  </header>
                  <ul className="rdy-summary">
                    {report.summary.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </section>

                <section className="rdy-panel">
                  <header className="rdy-panel__head">
                    <h2 className="rdy-panel__title">快捷入口</h2>
                  </header>
                  <nav className="rdy-shortcuts" aria-label="運維捷徑">
                    <Link to="/system" className="rdy-shortcut">
                      <span className="rdy-shortcut__t">主機設定</span>
                      <span className="rdy-shortcut__d">hostname · 電源 · NTP</span>
                    </Link>
                    <Link to="/system/unit" className="rdy-shortcut">
                      <span className="rdy-shortcut__t">控制面 unit</span>
                      <span className="rdy-shortcut__d">systemd 安裝／啟用</span>
                    </Link>
                    <Link to="/services" className="rdy-shortcut">
                      <span className="rdy-shortcut__t">服務矩陣</span>
                      <span className="rdy-shortcut__d">nginx · DB · 生命週期</span>
                    </Link>
                    <Link to="/metrics" className="rdy-shortcut">
                      <span className="rdy-shortcut__t">主機指標</span>
                      <span className="rdy-shortcut__d">負載 · 記憶體 · 告警</span>
                    </Link>
                    <Link to="/firewall" className="rdy-shortcut">
                      <span className="rdy-shortcut__t">防火牆</span>
                      <span className="rdy-shortcut__d">UFW 規則</span>
                    </Link>
                    <Link to="/fail2ban" className="rdy-shortcut">
                      <span className="rdy-shortcut__t">Fail2ban</span>
                      <span className="rdy-shortcut__d">jail · ban</span>
                    </Link>
                  </nav>
                </section>

                <p className="rdy-footnote">
                  政策：郵件 PTR／Port 25／域名商 DNS 永不自動宣稱完成。
                  HTTP 503 = 未達標但仍有完整報告（非假成功）。
                </p>
              </div>
            ) : null}
          </PageTabs>
        </div>
      ) : null}

      {!busy && !report && !error ? (
        <div className="rdy-empty rdy-empty--start">
          <strong>尚未探測</strong>
          <p>按「重新探測」開始唯讀就緒檢查。</p>
          <Button variant="primary" size="md" onClick={() => void load()}>
            執行就緒檢查
          </Button>
        </div>
      ) : null}
    </FeaturePageLayout>
  );
}
