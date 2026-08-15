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
import { toast } from '../../shared/stores/toast-store';
import { api } from '../../shared/services/api';

const RDY_TABS = ['priority', 'checklist', 'about'] as const;

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

type TFn = (k: string, opts?: Record<string, unknown>) => string;

export type LeftoverKind = 'apache' | 'vsftpd' | 'cli' | 'nginx' | 'dovecot' | 'other';

/** 「阻擋」= critical subset of 缺少 — not a disjoint fourth bucket. */
export function isCriticalMissing(item: ReadinessItemDto): boolean {
  if (item.level !== 'missing') return false;
  if (item.severity === 'critical') return true;
  return (
    item.id === 'bin-nginx' ||
    item.id === 'bin-node' ||
    item.id === 'control-plane' ||
    item.id === 'execute-policy' ||
    item.id === 'root'
  );
}

export function blockingMissingItems(items: ReadinessItemDto[]): ReadinessItemDto[] {
  return items.filter(isCriticalMissing);
}

/** Missing owner_user_id is real — do not show green ready. */
export function honestIsolationItem(item: ReadinessItemDto): ReadinessItemDto {
  if (item.level === 'ready' && /owner_user_id/i.test(item.detail ?? '')) {
    return { ...item, level: 'degraded' };
  }
  return item;
}

export function honestReadinessItems(items: ReadinessItemDto[]): ReadinessItemDto[] {
  return items.map(honestIsolationItem);
}

export function scoreFromItems(items: ReadinessItemDto[]): {
  ready: number;
  degraded: number;
  missing: number;
  total: number;
} {
  return {
    ready: items.filter((i) => i.level === 'ready').length,
    degraded: items.filter((i) => i.level === 'degraded').length,
    missing: items.filter((i) => i.level === 'missing').length,
    total: items.length,
  };
}

export function leftoverKindFromNote(note: string): LeftoverKind {
  const s = String(note || '');
  if (/ysk-000-default|catch-all|nginx-sync/i.test(s)) return 'nginx';
  if (/Apache leftover|Apache 遺留|Apache 預設|Apache 000-default|sites-enabled\/000-default/i.test(s)) {
    return 'apache';
  }
  if (/vsftpd/i.test(s)) return 'vsftpd';
  if (/rm -f|leftover CLI|stale leftover|舊 CLI|舊版 CLI|PATH may prefer|PATH 可能/i.test(s)) {
    return 'cli';
  }
  if (/Dovecot|ssl_cert/i.test(s)) return 'dovecot';
  return 'other';
}

export function leftoverHrefForKind(kind: LeftoverKind): string | undefined {
  if (kind === 'apache') return '/apache';
  if (kind === 'vsftpd') return '/ftp';
  if (kind === 'nginx') return '/nginx';
  if (kind === 'dovecot') return '/email';
  if (kind === 'cli') return '/updates';
  return undefined;
}

export function leftoverTitleForKind(kind: LeftoverKind, t: TFn): string {
  if (kind === 'apache') return t('readiness.leftoverApache');
  if (kind === 'vsftpd') return t('readiness.leftoverVsftpd');
  if (kind === 'cli') return t('readiness.leftoverCli');
  if (kind === 'nginx') return t('readiness.leftoverNginx');
  if (kind === 'dovecot') return t('readiness.leftoverDovecot');
  return t('readiness.leftoverOther');
}

/** Split overlay leftover blob (backend joins notes with " · "). */
export function splitLeftoverDetail(detail: string): string[] {
  return String(detail || '')
    .split(/\s·\s|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function localizeReadinessCopy(
  text: string,
  t: TFn,
): { display: string; technical?: string } {
  const raw = String(text ?? '');
  if (!raw) return { display: '' };
  const tech: string[] = [];
  let display = raw;

  if (/^PHP apt source \(ondrej residual\)$/i.test(display)) {
    return { display: t('readiness.ondrejTitle') };
  }
  if (/No ondrej Launchpad PHP sources/i.test(display)) {
    return { display: t('readiness.ondrejNone'), technical: raw };
  }
  const ondrejFound = display.match(/Found legacy ondrej\/php sources[^:]*:\s*(.+)$/i);
  if (ondrejFound) {
    return {
      display: t('readiness.ondrejFound', { paths: ondrejFound[1] }),
      technical: raw,
    };
  }

  const sysctl = display.match(/^systemctl is-active:\s*(.+)$/i);
  if (sysctl) {
    const status = sysctl[1].trim();
    return {
      display:
        status.toLowerCase() === 'active'
          ? t('readiness.systemctlActive')
          : t('readiness.systemctlStatus', { status }),
      technical: `systemctl is-active: ${status}`,
    };
  }

  if (/missing panel owner_user_id/i.test(display)) {
    display = display.replace(
      /missing panel owner_user_id(?:\s*\([^)]*\))?/gi,
      t('readiness.missingOwner'),
    );
    tech.push('owner_user_id');
  }
  if (/尚未\s*os_provisioned/i.test(display)) {
    display = display.replace(/尚未\s*os_provisioned/gi, t('readiness.notOsProvisioned'));
    tech.push('os_provisioned');
  }

  // Package names / PATH stay English
  display = display.replace(/在 PATH/g, 'in PATH');
  const inPath = display.match(/^(\S+)\s+in PATH$/i);
  if (inPath) {
    display = t('readiness.binInPath', { bin: inPath[1] });
  }

  return { display, technical: tech.length ? [...new Set(tech)].join('\n') : undefined };
}

export function leftoverPartsFromItem(
  item: ReadinessItemDto,
  t: TFn,
): Array<{
  kind: LeftoverKind;
  title: string;
  display: string;
  technical?: string;
  href?: string;
}> {
  if (item.id !== 'host-leftovers' || item.level === 'ready') return [];
  const parts = splitLeftoverDetail(item.detail);
  if (parts.length === 0) return [];
  return parts.map((p) => {
    const kind = leftoverKindFromNote(p);
    const loc = localizeReadinessCopy(p, t);
    return {
      kind,
      title: leftoverTitleForKind(kind, t),
      display: loc.display,
      technical: loc.technical ?? (p !== loc.display ? p : undefined),
      href: leftoverHrefForKind(kind),
    };
  });
}

function ItemRow({
  item,
  index,
  emphasize,
  t,
  fixing,
  onFixAction,
}: {
  item: ReadinessItemDto;
  index?: number;
  emphasize?: boolean;
  t: (k: string, opts?: Record<string, unknown>) => string;
  fixing?: boolean;
  onFixAction?: (action: string) => void;
}) {
  const sev = severityLabel(item.severity, t);
  const leftoverParts = leftoverPartsFromItem(item, t);
  const titleLoc = localizeReadinessCopy(item.title, t);
  const detailLoc = localizeReadinessCopy(item.detail, t);
  const canAction = Boolean(item.fixAction) && item.level !== 'ready' && onFixAction;
  const singleLeftoverHref =
    leftoverParts.length === 1 ? leftoverParts[0]?.href : undefined;
  const canHref =
    Boolean(singleLeftoverHref || item.fixHref) &&
    item.level !== 'ready' &&
    leftoverParts.length <= 1;
  const href = singleLeftoverHref || item.fixHref;
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
          <h3 className="rdy-item__title">{titleLoc.display}</h3>
          <Badge tone={levelTone(item.level)}>{levelLabel(item.level, t)}</Badge>
          {sev ? <span className="rdy-item__sev">{sev}</span> : null}
        </div>
        {leftoverParts.length > 1 ? (
          <ul className="list-plain list-spaced">
            {leftoverParts.map((p, i) => (
              <li key={`${p.kind}-${i}`}>
                <strong>{p.title}</strong>
                <p className="rdy-item__detail">{p.display}</p>
                {p.technical ? (
                  <details>
                    <summary className="muted u-text-sm">{t('readiness.techDetails')}</summary>
                    <code className="u-block">{p.technical}</code>
                  </details>
                ) : null}
                {p.href ? (
                  <Link
                    to={p.href}
                    className="btn btn--sm btn--secondary"
                  >
                    {p.kind === 'cli' ? t('readiness.leftoverApply') : t('readiness.fix')}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="rdy-item__detail">{detailLoc.display}</p>
            {detailLoc.technical ? (
              <details>
                <summary className="muted u-text-sm">{t('readiness.techDetails')}</summary>
                <code className="u-block">{detailLoc.technical}</code>
              </details>
            ) : null}
          </>
        )}
        {item.fixHint && item.level !== 'ready' ? (
          <p className="rdy-item__hint">{item.fixHint}</p>
        ) : null}
        {item.id.startsWith('project-isolation-') &&
        /owner_user_id/i.test(item.detail ?? '') ? (
          <p className="rdy-item__hint">{t('readiness.isolationOwnerDegrades')}</p>
        ) : null}
        <div className="rdy-item__meta">
          <code className="rdy-item__id">{item.id}</code>
          {item.spec ? <span className="rdy-item__spec">{item.spec}</span> : null}
        </div>
      </div>
      <div className="rdy-item__action">
        {canAction ? (
          <Button
            variant={emphasize || item.level === 'missing' ? 'primary' : 'secondary'}
            size="sm"
            loading={fixing}
            onClick={() => onFixAction!(item.fixAction!)}
          >
            {t('readiness.fixNow')}
          </Button>
        ) : canHref ? (
          <Link
            to={href!}
            className={`btn btn--sm ${emphasize || item.level === 'missing' ? 'btn--primary' : 'btn--secondary'}`}
          >
            {leftoverParts[0]?.kind === 'cli' ? t('readiness.leftoverApply') : t('readiness.fix')}
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
  const [fixingAction, setFixingAction] = useState<string | null>(null);

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

  const runFix = useCallback(
    async (action: string) => {
      setFixingAction(action);
      setError(null);
      try {
        const r = await systemApi.readinessFix(action);
        if (r.ok) {
          toast.ok(
            action === 'build-web-ui'
              ? t('readiness.fixDoneWebUi')
              : t('readiness.fixDone'),
          );
          await load();
        } else {
          const codes = (r as { codes?: string[] }).codes ?? [];
          // Prefer localized operator copy when auto-build is impossible
          if (action === 'build-web-ui' && codes.includes('NO_MONOREPO')) {
            setError(t('readiness.itemWebBuildManual'));
          } else {
            setError(
              (r.notes && r.notes.length ? r.notes.join('；') : null) ||
                t('readiness.fixFailed'),
            );
          }
          await load();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t('readiness.fixFailed'));
      } finally {
        setFixingAction(null);
      }
    },
    [load, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(
    () => (report ? honestReadinessItems(report.items) : []),
    [report],
  );

  const score = useMemo(
    () => (report ? scoreFromItems(items) : undefined),
    [report, items],
  );

  /** Priority list may include critical degraded; header 「阻擋」 is missing-only. */
  const priorityItems = useMemo(() => {
    if (!report) return [];
    const src = honestReadinessItems(report.blockers?.length ? report.blockers : items);
    if (report.blockers?.length) return src;
    return items.filter(
      (i) =>
        i.level === 'missing' ||
        (i.severity === 'critical' && i.level !== 'ready') ||
        ((i.id === 'execute-policy' || i.id === 'root') && i.level !== 'ready'),
    );
  }, [report, items]);

  const blockers = useMemo(() => blockingMissingItems(items), [items]);

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
          ? items
          : items.filter((i) => i.level === filter);
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
  }, [report, items, filter, catFilter, q, blockers]);

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
    if (!score?.total) return 0;
    return Math.round((score.ready / score.total) * 100);
  }, [score]);

  const heroTone = report?.productionReady
    ? 'ok'
    : blockers.length
      ? 'danger'
      : 'warn';

  async function downloadReport() {
    if (!report) return;
    const filename = `ysk-readiness-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    try {
      await api.downloadAuthenticated('/api/v1/readiness/export', filename);
      toast.ok(t('readiness.exportStarted', { name: filename }));
    } catch (e) {
      try {
        const blob = new Blob([JSON.stringify(report, null, 2)], {
          type: 'application/json; charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        window.setTimeout(() => {
          a.remove();
          URL.revokeObjectURL(url);
        }, 2000);
        toast.ok(t('readiness.exportStarted', { name: filename }));
      } catch {
        toast.error(e instanceof Error ? e.message : t('common.opFailed'));
      }
    }
  }

  const firstFix = priorityItems.find((b) => b.fixHref || leftoverPartsFromItem(b, t)[0]?.href);

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
                  label: t('dashboard.executeLabel'),
                  value: report.executeEnabled ? t('readiness.executeOn') : t('readiness.executeOff'),
                  tone: report.executeEnabled ? 'ok' : 'warn' },
                {
                  label: t('readiness.rootLabel'),
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
                  tone: blockers.length ? 'danger' : 'ok',
                  hint: t('readiness.blockersHint') },
              ] }
          : undefined
      }
      actions={<>
          <Button variant="secondary" size="sm" loading={busy} onClick={bindVoid(load)}>
            {busy ? t('readiness.probing') : t('readiness.reprobe')}
          </Button>
          <Button variant="ghost" size="sm" disabled={!report} onClick={() => void downloadReport()}>
            {t('readiness.exportReport')}
          </Button>
          {firstFix ? (
            <Link
              to={
                firstFix.fixHref ||
                leftoverPartsFromItem(firstFix, t)[0]?.href ||
                '/system/readiness'
              }
              className={buttonClassName({ variant: 'primary', size: 'sm' })}
            >
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
                badge: priorityItems.length || undefined },
              {
                id: 'checklist',
                label: t('readiness.checklistTab'),
                badge: report.items.length || undefined },
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
                    {priorityItems.length > 0 ? (
                      <Badge tone="danger">{t('readiness.nItems', { count: priorityItems.length })}</Badge>
                    ) : (
                      <Badge tone="ok">{t('readiness.noHardBlockers')}</Badge>
                    )}
                  </header>

                  {priorityItems.length === 0 ? (
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
                      {priorityItems.map((item, i) => (
                        <ItemRow key={item.id} item={item} t={t} index={i} emphasize fixing={fixingAction === item.fixAction} onFixAction={runFix} />
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
                          {t('readiness.showing', { shown: filtered.length, total: items.length })}
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
                            ['all', t('readiness.all'), items.length],
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
                            title={id === 'blockers' ? t('readiness.blockersHint') : undefined}
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
                            const count = items.filter(
                              (i) => i.category === c,
                            ).length;
                            const bad = items.filter(
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
                              <ItemRow key={item.id} item={item} t={t} fixing={fixingAction === item.fixAction} onFixAction={runFix} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}

            {tab === 'about' ? (
              <div className="tab-panel stack">
                {report.summary?.length ? (
                  <section className="rdy-panel" aria-labelledby="rdy-about-summary">
                    <header className="rdy-panel__head">
                      <h2 id="rdy-about-summary" className="rdy-panel__title">
                        {t('readiness.summary')}
                      </h2>
                    </header>
                    <ul className="rdy-summary">
                      {report.summary.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <p className="rdy-footnote">{t('readiness.policyNote')}</p>
                <PageGuide guideId="readiness" />
              </div>
            ) : null}
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
