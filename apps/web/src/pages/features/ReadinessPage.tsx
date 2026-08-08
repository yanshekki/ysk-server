/**
 * Production readiness — tabbed ops console (honest gate).
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
  LoadingBlock,
  PageTabs,
  buttonClassName } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import type {
  ProductionReadinessDto,
  ReadinessItemDto,
  ReadinessLevel } from '../../features/system/api';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { bindSet, bindInput, bindVoid } from '../bind-handlers';

const RDY_TABS = ['priority', 'checklist', 'summary', 'about'] as const;

export function catLabel(cat: string, t: (k: string) => string): string {
  const key = `readiness.cat.${cat}`;
  const v = t(key);
  return v === key ? cat : v;
}

type LevelFilter = 'all' | 'blockers' | 'missing' | 'degraded' | 'ready';

export function levelTone(level: ReadinessLevel): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (level === 'ready') return 'ok';
  if (level === 'degraded') return 'warn';
  if (level === 'missing') return 'danger';
  return 'neutral';
}

export function levelLabel(level: ReadinessLevel, t: (k: string) => string): string {
  if (level === 'ready') return t('readiness.level.ready');
  if (level === 'degraded') return t('readiness.level.degraded');
  if (level === 'missing') return t('readiness.level.missing');
  return t('readiness.level.unknown');
}

export function severityLabel(s: string | undefined, t: (k: string) => string): string | null {
  if (s === 'critical') return t('readiness.severity.critical');
  if (s === 'recommended') return t('readiness.severity.recommended');
  if (s === 'optional') return t('readiness.severity.optional');
  return null;
}

function ItemRow({
  item,
  index,
  emphasize,
  t }: {
  item: ReadinessItemDto;
  index?: number;
  emphasize?: boolean;
  t: (k: string) => string;
}) {
  const sev = severityLabel(item.severity, t);
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
          <Badge tone={levelTone(item.level)}>{levelLabel(item.level, t)}</Badge>
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
            {t('readiness.fix')}
          </Link>
        ) : item.level === 'ready' ? (
          <span className="rdy-item__ok">{t('readiness.passed')}</span>
        ) : (
          <span className="rdy-item__na">—</span>
        )}
      </div>
    </article>
  );
}

export function ReadinessPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
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
      setError(e instanceof Error ? e.message : t('readiness.checkFailed'));
    } finally {
      setBusy(false);
    }
  }, [t, locale]);

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
      type: 'application/json; charset=utf-8' });
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
      title={t('nav.readiness')}
      showCapability={false}
      status={
        report
          ? {
              pill: {
                label: report.productionReady
                  ? t('readiness.gatePass', { pct: scorePct })
                  : t('readiness.gateFail', { pct: scorePct }),
                tone: heroTone },
              items: [
                {
                  label: 'EXECUTE',
                  value: report.executeEnabled ? t('readiness.executeOn') : t('readiness.executeOff'),
                  tone: report.executeEnabled ? 'ok' : 'warn' },
                {
                  label: 'Root',
                  value: report.isRoot ? t('common.yes') : t('common.no'),
                  tone: report.isRoot ? 'ok' : 'warn' },
                { label: t('common.ready'), value: score?.ready ?? 0, tone: 'ok' },
                {
                  label: t('common.degraded'),
                  value: score?.degraded ?? 0,
                  tone: (score?.degraded ?? 0) > 0 ? 'warn' : 'neutral' },
                {
                  label: t('common.missing'),
                  value: score?.missing ?? 0,
                  tone: (score?.missing ?? 0) > 0 ? 'danger' : 'neutral' },
                {
                  label: t('readiness.blockers'),
                  value: blockers.length,
                  tone: blockers.length ? 'danger' : 'ok' },
              ] }
          : undefined
      }
      actions={<>
          <Button variant="secondary" size="sm" loading={busy} onClick={bindVoid(load)}>
            {busy ? t('readiness.probing') : t('readiness.reprobe')}
          </Button>
          <Button variant="ghost" size="sm" disabled={!report} onClick={bindVoid(downloadReport)}>
            {t('readiness.exportReport')}
          </Button>
          {firstFix ? (
            <Link to={firstFix.fixHref!} className={buttonClassName({ variant: 'primary', size: 'sm' })}>
              {t('readiness.firstBlocker')}
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
              {t('readiness.viewRecommended')}
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {busy && !report ? <LoadingBlock label={t('readiness.loadingProbe')} /> : null}

      {report ? (
        <div className="rdy">
          <PageTabs
            tabs={[
              {
                id: 'priority',
                label: t('readiness.priorityTab'),
                badge: blockers.length || undefined },
              {
                id: 'checklist',
                label: t('readiness.checklistTab'),
                badge: report.items.length || undefined },
              { id: 'summary', label: t('readiness.summaryTab') },
            
          { id: 'about', label: t('common.about') },
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
                        {t('readiness.priorityTitle')}
                      </h2>
                      <p className="rdy-panel__sub">
                        {t('readiness.prioritySub')}
                      </p>
                    </div>
                    {blockers.length > 0 ? (
                      <Badge tone="danger">{t('readiness.nItems', { count: blockers.length })}</Badge>
                    ) : (
                      <Badge tone="ok">{t('readiness.noHardBlockers')}</Badge>
                    )}
                  </header>

                  {blockers.length === 0 ? (
                    <div className="rdy-empty rdy-empty--ok">
                      <strong>{t('readiness.noHardBlockersTitle')}</strong>
                      <p>
                        {t('readiness.prodGate')}
                        {report.productionReady ? t('readiness.gatePassed') : t('readiness.gateMaybePerm')}。
                        {t('readiness.viewDegradedHint')}
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setFilter('degraded');
                          setTab('checklist');
                        }}
                      >
                        {t('readiness.viewDegraded')}
                      </Button>
                    </div>
                  ) : (
                    <div className="rdy-item-list">
                      {blockers.map((item, i) => (
                        <ItemRow key={item.id} item={item} t={t} index={i} emphasize />
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
                        <h2 className="rdy-panel__title">{t('readiness.fullChecklist')}</h2>
                        <p className="rdy-panel__sub">
                          {t('readiness.showing', { shown: filtered.length, total: report.items.length })}
                          {catFilter !== 'all'
                            ? ` · ${catLabel(catFilter, t)}`
                            : ''}
                        </p>
                      </div>
                    </div>

                    <div className="rdy-toolbar">
                      <div className="rdy-chips" role="tablist" aria-label={t('readiness.filterAria')}>
                        {(
                          [
                            ['all', t('readiness.all'), report.items.length],
                            ['blockers', t('readiness.blockers'), blockers.length],
                            ['missing', t('common.missing'), score?.missing ?? 0],
                            ['degraded', t('common.degraded'), score?.degraded ?? 0],
                            ['ready', t('common.ready'), score?.ready ?? 0],
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
                            onClick={bindSet(setFilter, id)}
                          >
                            {label}
                            <span className="rdy-chip__n">{n}</span>
                          </button>
                        ))}
                      </div>

                      <div className="rdy-toolbar__filters">
                        <label className="rdy-field">
                          <span className="rdy-field__lab">{t('readiness.category')}</span>
                          <select
                            value={catFilter}
                            onChange={bindInput(setCatFilter)}
                          >
                            <option value="all">{t('readiness.allCategories')}</option>
                            {categories.map((c) => (
                              <option key={c} value={c}>
                                {catLabel(c, t)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="rdy-field rdy-field--grow">
                          <span className="rdy-field__lab">{t('common.search')}</span>
                          <input
                            value={q}
                            onChange={bindInput(setQ)}
                            placeholder={t('readiness.searchPh')}
                            autoComplete="off"
                          />
                        </label>
                      </div>

                      {categories.length > 1 ? (
                        <div className="rdy-cat-pills" aria-label={t('readiness.quickCatAria')}>
                          <button
                            type="button"
                            className={`rdy-pill${catFilter === 'all' ? ' rdy-pill--active' : ''}`}
                            onClick={bindSet(setCatFilter, 'all')}
                          >
                            {t('readiness.all')}
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
                                onClick={bindSet(setCatFilter, c)}
                              >
                                {catLabel(c, t)}
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
                      <strong>{t('readiness.noMatchTitle')}</strong>
                      <p>{t('readiness.noMatchDesc')}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setFilter('all');
                          setCatFilter('all');
                          setQ('');
                        }}
                      >
                        {t('readiness.resetFilters')}
                      </Button>
                    </div>
                  ) : (
                    <div className="rdy-groups">
                      {grouped.map(({ cat, items }) => (
                        <div key={cat} className="rdy-group">
                          <div className="rdy-group__head">
                            <h3 className="rdy-group__title">
                              {catLabel(cat, t)}
                            </h3>
                            <span className="rdy-group__count">{items.length}</span>
                          </div>
                          <div className="rdy-item-list">
                            {items.map((item) => (
                              <ItemRow key={item.id} item={item} t={t} />
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
                    <h2 className="rdy-panel__title">{t('readiness.summary')}</h2>
                  </header>
                  <ul className="rdy-summary">
                    {report.summary.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </section>

                <section className="rdy-panel">
                  <header className="rdy-panel__head">
                    <h2 className="rdy-panel__title">{t('readiness.shortcuts')}</h2>
                  </header>
                  <nav className="rdy-shortcuts" aria-label={t('readiness.opsShortcutsAria')}>
                    <Link to="/system" className="rdy-shortcut">
                      <span className="rdy-shortcut__t">{t('readiness.scHost')}</span>
                      <span className="rdy-shortcut__d">{t('readiness.scHostD')}</span>
                    </Link>
                    <Link to="/system/unit" className="rdy-shortcut">
                      <span className="rdy-shortcut__t">{t('readiness.scUnit')}</span>
                      <span className="rdy-shortcut__d">{t('readiness.scUnitD')}</span>
                    </Link>
                    <Link to="/services" className="rdy-shortcut">
                      <span className="rdy-shortcut__t">{t('readiness.scServices')}</span>
                      <span className="rdy-shortcut__d">{t('readiness.scServicesD')}</span>
                    </Link>
                    <Link to="/metrics" className="rdy-shortcut">
                      <span className="rdy-shortcut__t">{t('readiness.scMetrics')}</span>
                      <span className="rdy-shortcut__d">{t('readiness.scMetricsD')}</span>
                    </Link>
                    <Link to="/protection" className="rdy-shortcut">
                      <span className="rdy-shortcut__t">{t('readiness.scProtection')}</span>
                      <span className="rdy-shortcut__d">{t('readiness.scProtectionD')}</span>
                    </Link>
                  </nav>
                </section>

                <p className="rdy-footnote">
                  {t('readiness.policyNote')}
                </p>
              </div>
            ) : null}
          
        {tab === 'about' ? <PageGuide guideId="readiness" /> : null}
      </PageTabs>
        </div>
      ) : null}

      {!busy && !report && !error ? (
        <div className="rdy-empty rdy-empty--start">
          <strong>{t('readiness.notProbedTitle')}</strong>
          <p>{t('readiness.notProbedDesc')}</p>
          <Button variant="primary" size="md" onClick={bindVoid(load)}>
            {t('readiness.runCheck')}
          </Button>
        </div>
      ) : null}
    </FeaturePageLayout>
  );
}
