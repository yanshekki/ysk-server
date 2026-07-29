/**
 * Production readiness — professional ops console (honest gate).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  FeaturePageLayout,
  LoadingBlock,
} from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import type {
  ProductionReadinessDto,
  ReadinessItemDto,
  ReadinessLevel,
} from '../../features/system/api';

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

function modeLabel(mode: string): string {
  if (mode === 'production_capable') return '可生產';
  if (mode === 'degraded') return '降級';
  return mode;
}

function relTime(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 10) return '剛剛';
    if (sec < 60) return `${sec} 秒前`;
    if (sec < 3600) return `${Math.floor(sec / 60)} 分鐘前`;
    return new Date(iso).toLocaleString('zh-TW');
  } catch {
    return iso;
  }
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
      actions={
        <>
          <Button variant="secondary" size="md" loading={busy} onClick={() => void load()}>
            {busy ? '探測中…' : '重新探測'}
          </Button>
          <Button variant="ghost" size="md" disabled={!report} onClick={() => downloadReport()}>
            匯出報告
          </Button>
        </>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {busy && !report ? <LoadingBlock label="正在探測主機能力…" /> : null}

      {report ? (
        <div className="rdy">
          {/* —— Hero —— */}
          <section
            className={`rdy-hero rdy-hero--${heroTone}`}
            aria-label="就緒總覽"
          >
            <div className="rdy-hero__main">
              <div className="rdy-hero__gauge" aria-hidden>
                <div
                  className="rdy-hero__ring"
                  style={{ ['--rdy-score' as string]: String(scorePct) } as CSSProperties}
                >
                  <div className="rdy-hero__ring-inner">
                    <span className="rdy-hero__score">{scorePct}</span>
                    <span className="rdy-hero__score-unit">%</span>
                  </div>
                </div>
              </div>

              <div className="rdy-hero__copy">
                <div className="rdy-hero__eyebrow">Production readiness</div>
                <h2 className="rdy-hero__title">
                  <span className={`rdy-hero__pill rdy-hero__pill--${heroTone}`}>
                    {report.productionReady ? '門檻通過' : '尚未達標'}
                  </span>
                  {report.productionReady
                    ? '此主機已具備生產套用能力'
                    : '請先處理下方優先阻擋項'}
                </h2>
                <p className="rdy-hero__hint">
                  門檻 = root + <code>YSK_EXECUTE</code> + nginx／node 在 PATH + dataDir。
                  就緒 ≠ 已對外；需套用後才上線。
                </p>
                <div className="rdy-hero__meta">
                  <span>
                    模式 <strong>{modeLabel(report.mode)}</strong>
                  </span>
                  <span className="rdy-hero__dot" />
                  <span>
                    {score?.ready ?? 0}/{score?.total ?? 0} 項就緒
                  </span>
                  <span className="rdy-hero__dot" />
                  <span>探測 {relTime(report.generatedAt)}</span>
                </div>
                <div className="rdy-hero__cta">
                  {firstFix ? (
                    <Link to={firstFix.fixHref!} className="btn btn--primary btn--md">
                      處理首個阻擋：{firstFix.title}
                    </Link>
                  ) : (
                    <Button variant="primary" size="md" onClick={() => setFilter('degraded')}>
                      檢視建議項
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setFilter('all');
                      document.getElementById('rdy-checklist')?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                    }}
                  >
                    完整清單
                  </Button>
                  <Link to="/system" className="btn btn--ghost btn--md">
                    主機設定
                  </Link>
                </div>
              </div>
            </div>

            <ul className="rdy-rail" aria-label="關鍵能力">
              <li>
                <span className="rdy-rail__k">EXECUTE</span>
                <Badge tone={report.executeEnabled ? 'ok' : 'warn'}>
                  {report.executeEnabled ? '已開' : '未開'}
                </Badge>
              </li>
              <li>
                <span className="rdy-rail__k">Root</span>
                <Badge tone={report.isRoot ? 'ok' : 'warn'}>
                  {report.isRoot ? '是' : '否'}
                </Badge>
              </li>
              <li>
                <span className="rdy-rail__k">就緒</span>
                <Badge tone="ok">{score?.ready ?? 0}</Badge>
              </li>
              <li>
                <span className="rdy-rail__k">降級</span>
                <Badge tone={(score?.degraded ?? 0) > 0 ? 'warn' : 'neutral'}>
                  {score?.degraded ?? 0}
                </Badge>
              </li>
              <li>
                <span className="rdy-rail__k">缺少</span>
                <Badge tone={(score?.missing ?? 0) > 0 ? 'danger' : 'neutral'}>
                  {score?.missing ?? 0}
                </Badge>
              </li>
              <li>
                <span className="rdy-rail__k">阻擋</span>
                <Badge tone={blockers.length ? 'danger' : 'ok'}>{blockers.length}</Badge>
              </li>
            </ul>

            <div className="rdy-bars" aria-hidden>
              <div className="rdy-bars__track">
                <div
                  className="rdy-bars__seg rdy-bars__seg--ok"
                  style={{ flex: score?.ready || 0.001 }}
                  title={`就緒 ${score?.ready}`}
                />
                <div
                  className="rdy-bars__seg rdy-bars__seg--warn"
                  style={{ flex: score?.degraded || 0.001 }}
                  title={`降級 ${score?.degraded}`}
                />
                <div
                  className="rdy-bars__seg rdy-bars__seg--danger"
                  style={{ flex: score?.missing || 0.001 }}
                  title={`缺少 ${score?.missing}`}
                />
              </div>
              <div className="rdy-bars__legend">
                <span>
                  <i className="rdy-bars__dot rdy-bars__dot--ok" /> 就緒 {score?.ready}
                </span>
                <span>
                  <i className="rdy-bars__dot rdy-bars__dot--warn" /> 降級 {score?.degraded}
                </span>
                <span>
                  <i className="rdy-bars__dot rdy-bars__dot--danger" /> 缺少 {score?.missing}
                </span>
              </div>
            </div>
          </section>

          {/* —— Layout: next steps + summary —— */}
          <div className="rdy-grid">
            <section className="rdy-panel rdy-panel--primary" aria-labelledby="rdy-next-title">
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
                    onClick={() => setFilter('degraded')}
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

            <aside className="rdy-side">
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
            </aside>
          </div>

          {/* —— Full checklist —— */}
          <section className="rdy-panel rdy-panel--checklist" id="rdy-checklist">
            <header className="rdy-panel__head rdy-panel__head--stack">
              <div className="rdy-panel__head-row">
                <div>
                  <h2 className="rdy-panel__title">完整檢查清單</h2>
                  <p className="rdy-panel__sub">
                    顯示 {filtered.length} / {report.items.length} 項
                    {catFilter !== 'all' ? ` · ${CAT_LABEL[catFilter] ?? catFilter}` : ''}
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
                      const count = report.items.filter((i) => i.category === c).length;
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
