/**
 * Smart updates — tabbed: packages · panel self · schedule · policy.
 * Inventory filters are server-backed (ListQuery on GET /updates/inventory).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUpdates } from '../features/updates';
import type { AdviceRow } from '../features/updates';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  InstallStreamPanel,
  InfoCard,
  InfoCardGrid,
  ListToolbar,
  LoadingBlock,
  PageTabs } from '../shared/components/ui';
import type { InstallStreamLine } from '../shared/components/ui';
import { usePageTab } from '../shared/hooks/usePageTab';
import { useCapabilities } from '../shared/hooks/useCapabilities';
import { humanizeOperatorNote } from '../shared/lib/operator-messages';
import { bindAllOrValue, bindCall1, bindCall2, bindCloseIfIdle, bindInput, bindSet, bindValueSet, bindVoid } from './bind-handlers';

const UPD_TABS = ['packages', 'panel', 'schedule', 'policy', 'about'] as const;
type RiskFilter = 'all' | 'upgradable' | 'high' | 'medium' | 'low' | 'approval';

export function riskTone(risk?: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
  if (risk === 'critical' || risk === 'high') return 'danger';
  if (risk === 'medium') return 'warn';
  if (risk === 'low') return 'ok';
  return 'neutral';
}

export function riskLabel(risk: string | undefined, tr: (k: string) => string): string {
  if (risk === 'critical') return tr('updates.risk.critical');
  if (risk === 'high') return tr('updates.risk.high');
  if (risk === 'medium') return tr('updates.risk.medium');
  if (risk === 'low') return tr('updates.risk.low');
  return risk ?? '—';
}

export function isHighRisk(row: AdviceRow): boolean {
  return (
    row.risk === 'high' ||
    row.risk === 'critical' ||
    Boolean(row.requiresApproval)
  );
}

/** Map API advice enum to locale (never show raw English "update"/"skip"). */
export function adviceLabel(
  advice: string | undefined | null,
  tr: (k: string, o?: Record<string, unknown>) => string,
): string {
  const a = (advice ?? '').trim().toLowerCase();
  if (!a) return '—';
  const key = `updates.advice.${a}`;
  const out = tr(key, { defaultValue: '' });
  if (out && out !== key) return out;
  // fallbacks if locale missing
  if (a === 'update') return tr('updates.advice.update');
  if (a === 'skip') return tr('updates.advice.skip');
  if (a === 'watch') return tr('updates.advice.watch');
  if (a === 'urgent') return tr('updates.advice.urgent');
  return advice ?? '—';
}

/** Row key stable for selection set */
export function packageRowKey(row: {
  packageName?: string;
  currentVersion?: string;
}): string {
  return `${row.packageName ?? ''}@${row.currentVersion ?? ''}`;
}

export function relTime(iso: string | null, tr: (k: string, o?: Record<string, unknown>) => string): string {
  if (!iso) return '—';
  try {
    const ms = new Date(iso).getTime();
    const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (sec < 15) return tr('updates.justNow');
    if (sec < 60) return tr('updates.secAgo', { n: sec });
    if (sec < 3600) return tr('updates.minAgo', { n: Math.floor(sec / 60) });
    if (sec < 86400) return tr('updates.hourAgo', { n: Math.floor(sec / 3600) });
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Whether a package row is upgradable (candidate ≠ current). */
export function isUpgradableRow(row: {
  candidateVersion?: string | null;
  currentVersion?: string | null;
}): boolean {
  return Boolean(
    row.candidateVersion && row.candidateVersion !== row.currentVersion,
  );
}

/** Whether a package row matches the risk filter chip. */
export function matchesRiskFilter(
  row: AdviceRow,
  filter: RiskFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'upgradable') return isUpgradableRow(row);
  if (filter === 'approval') return Boolean(row.requiresApproval);
  if (filter === 'high') return row.risk === 'high' || row.risk === 'critical';
  if (filter === 'medium') return row.risk === 'medium';
  if (filter === 'low') return row.risk === 'low';
  return true;
}

/** Free-text match on package name / summary. */
export function matchesUpdateQuery(
  row: {
    name?: string;
    packageName?: string;
    package?: string;
    summary?: string;
    advice?: string;
    description?: string;
  },
  q: string,
): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay =
    `${row.name ?? ''} ${row.packageName ?? ''} ${row.package ?? ''} ${row.summary ?? ''} ${row.advice ?? ''} ${row.description ?? ''}`.toLowerCase();
  return hay.includes(s);
}

/** Count high-risk rows for strip. */
export function countHighRisk(rows: AdviceRow[] | null | undefined): number {
  return (rows ?? []).filter(isHighRisk).length;
}

/** Count upgradable rows. */
export function countUpgradable(
  rows:
    | Array<{ candidateVersion?: string | null; currentVersion?: string | null }>
    | null
    | undefined,
): number {
  return (rows ?? []).filter(isUpgradableRow).length;
}

/** Panel self-update status tone. */
export function selfUpdateTone(
  status: string | null | undefined,
): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (!status) return 'neutral';
  if (status === 'up_to_date' || status === 'ok') return 'ok';
  if (status === 'available' || status === 'pending') return 'warn';
  if (status === 'failed' || status === 'error') return 'danger';
  return 'neutral';
}

export function UpdatesPage() {
  const { t } = useTranslation();
  const { can } = useCapabilities();
  const canApply = can('updates.apply');
  const {
    inventory,
    selfUpdate,
    lastAt,
    jobs,
    error,
    busy,
    msg,
    setMsg,
    load,
    applySelf,
    applyPackage,
    applyPackages } = useUpdates();

  const [tab, setTab] = usePageTab(UPD_TABS, 'packages');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [searchParams] = useSearchParams();
  const qFromUrl = (searchParams.get('q') ?? '').trim();
  const [q, setQ] = useState(qFromUrl);
  const [debouncedQ, setDebouncedQ] = useState(qFromUrl);
  const [highRiskApply, setHighRiskApply] = useState<AdviceRow | null>(null);
  /** Selected package row keys for bulk update */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  const [applyLog, setApplyLog] = useState<InstallStreamLine[]>([]);
  /** Soft-cancel sequential fallback between packages */
  const [batchAbort, setBatchAbort] = useState<AbortController | null>(null);

  // Deep-link from software hub: /updates?q=nginx
  useEffect(() => {
    if (qFromUrl && qFromUrl !== q) {
      setQ(qFromUrl);
      setDebouncedQ(qFromUrl);
    }
    // Only re-sync when URL q changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qFromUrl]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const listQuery = useMemo(() => {
    const qparams: {
      q?: string;
      risk?: string;
      upgradable?: string;
      approval?: string;
      cached?: boolean;
    } = { cached: true };
    if (debouncedQ) qparams.q = debouncedQ;
    if (riskFilter === 'upgradable') qparams.upgradable = '1';
    else if (riskFilter === 'high') qparams.risk = 'high';
    else if (riskFilter === 'medium') qparams.risk = 'medium';
    else if (riskFilter === 'low') qparams.risk = 'low';
    else if (riskFilter === 'approval') qparams.approval = '1';
    return qparams;
  }, [debouncedQ, riskFilter]);

  // Server-backed filter: reload when listQuery changes (after first mount load from hook)
  useEffect(() => {
    void load(false, false, listQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when filters change
  }, [listQuery]);

  const highRisk = inventory.filter(
    (i) => i.risk === 'critical' || i.risk === 'high',
  ).length;
  const needApproval = inventory.filter((i) => i.requiresApproval).length;
  const withCve = inventory.filter((i) => (i.cves?.length ?? 0) > 0).length;

  const selfAvailable = Boolean(selfUpdate?.updateAvailable);
  const selfVersion = String(selfUpdate?.currentVersion ?? '—');
  const selfLatest = String(selfUpdate?.latestVersion ?? '—');
  const selfChannel = String(selfUpdate?.channel ?? '—');
  const selfChecked = selfUpdate?.checked !== false;
  const selfOk = selfUpdate?.ok !== false && selfChecked;

  const heroTone = highRisk > 0 ? 'danger' : selfAvailable ? 'warn' : 'ok';

  const upgradableCount = inventory.filter(
    (i) => i.candidateVersion && i.candidateVersion !== i.currentVersion,
  ).length;

  const filtered = inventory;
  const activeFilterCount =
    (q.trim() ? 1 : 0) + (riskFilter !== 'all' ? 1 : 0);

  const filteredUpgradable = useMemo(
    () => filtered.filter(isUpgradableRow),
    [filtered],
  );

  const selectedRows = useMemo(() => {
    return filtered.filter((r) => selectedKeys.has(packageRowKey(r)));
  }, [filtered, selectedKeys]);

  const selectedUpgradable = useMemo(
    () => selectedRows.filter(isUpgradableRow),
    [selectedRows],
  );

  const selectedHasHighRisk = useMemo(
    () =>
      selectedUpgradable.some(
        (r) => r.risk === 'high' || r.risk === 'critical' || r.requiresApproval,
      ),
    [selectedUpgradable],
  );

  function toggleSelect(row: AdviceRow, on: boolean) {
    if (!isUpgradableRow(row)) return;
    const k = packageRowKey(row);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });
  }

  function selectAllUpgradableInFilter() {
    if (!filteredUpgradable.length) {
      toastEmptySelect();
      return;
    }
    setSelectedKeys(new Set(filteredUpgradable.map(packageRowKey)));
  }

  function toastEmptySelect() {
    // lightweight: set batch progress message
    setBatchProgress(
      t('updates.batchNoneUpgradable', { }),
    );
  }

  function openBatchConfirm() {
    if (!selectedUpgradable.length) {
      setBatchProgress(
        t('updates.batchEmpty'),
      );
      return;
    }
    setBatchConfirmOpen(true);
  }

  async function runBatchApply() {
    if (!selectedUpgradable.length) return;
    setBatchConfirmOpen(false);
    const rows = [...selectedUpgradable];
    const ac = new AbortController();
    setBatchAbort(ac);
    setApplyLog([]);
    setBatchProgress(
      t('updates.batchProgress', {
        n: 0,
        total: rows.length,
        pkg: rows[0]?.packageName ?? '' }),
    );
    try {
      const result = await applyPackages(rows, {
        confirmHighRisk: true,
        quiet: true,
        signal: ac.signal,
        onLog: (line) => setApplyLog((prev) => [...prev.slice(-1999), line]),
        onProgress: (n, total, pkg) => {
          setBatchProgress(
            t('updates.batchProgress', {
              n,
              total,
              pkg }),
          );
        } });
      setSelectedKeys(new Set());
      setBatchProgress(
        t('updates.batchDone', {
          ok: result.ok.length,
          fail: result.fail.length }) +
          (result.fail.length
            ? ' · ' +
              t('updates.batchPartialFail', {
                list: result.fail
                  .slice(0, 5)
                  .map((f) => `${f.pkg}: ${f.message}`)
                  .join('；'),
                defaultValue: result.fail
                  .slice(0, 5)
                  .map((f) => `${f.pkg}: ${f.message}`)
                  .join('；') })
            : '') +
          (result.ok.length
            ? ' · ' +
              t('updates.batchRescanned', { })
            : ''),
      );
      // Do NOT reload cached inventory — applyPackages already rescanned live apt
    } finally {
      setBatchAbort(null);
    }
  }

  const allUpgradableSelected =
    filteredUpgradable.length > 0 &&
    filteredUpgradable.every((r) => selectedKeys.has(packageRowKey(r)));

  return (
    <FeaturePageLayout
      title={t('nav.updates')}
      showCapability={false}
      status={{
        pill: {
          label:
            highRisk > 0
              ? t('updates.highRiskN', { count: highRisk })
              : selfAvailable
                ? t('updates.panelUpdate')
                : inventory.length
                  ? t('updates.riskOk')
                  : t('updates.pendingScan'),
          tone: heroTone },
        items: [
          { label: t('updates.packages'), value: inventory.length },
          {
            label: t('updates.highRisk'),
            value: highRisk,
            tone: highRisk > 0 ? 'danger' : 'ok' },
          {
            label: t('updates.needApproval'),
            value: needApproval,
            tone: needApproval > 0 ? 'warn' : 'neutral' },
          {
            label: t('updates.hasCve'),
            value: withCve,
            tone: withCve > 0 ? 'warn' : 'neutral' },
          {
            label: t('updates.panel'),
            value: selfAvailable ? `${selfVersion}→${selfLatest}` : selfVersion,
            tone: selfAvailable ? 'warn' : 'ok' },
          {
            label: t('updates.schedule'),
            value: jobs.length },
        ] }}
      actions={
        <ActionBar align="end">
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={bindCall1(load, false)}
          >
            {t('updates.reload')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={bindCall2(load, true, true)}
            title={t('updates.osvTitle')}
          >
            {t('updates.scanOsv')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={bindCall2(load, true, false)}
          >
            {t('updates.scanPkgs')}
          </Button>
        </ActionBar>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      <PageTabs
        tabs={[
          {
            id: 'packages',
            label: t('updates.tabInventory'),
            badge: inventory.length || undefined },
          {
            id: 'panel',
            label: t('updates.tabSelf'),
            badge: selfAvailable ? t('updates.badgeUpdate') : undefined },
          {
            id: 'schedule',
            label: t('updates.schedule'),
            badge: jobs.length || undefined },
          { id: 'policy', label: t('updates.tabPolicy') },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'packages' ? (
          <div className="tab-panel stack">
            {batchProgress || applyLog.length > 0 ? (
              <div className="u-mb-3 stack">
                {batchProgress ? (
                  <Alert variant={busy ? 'info' : 'ok'}>
                    <div className="u-flex u-flex-wrap u-gap-2 u-items-center">
                      <span>{batchProgress}</span>
                      {busy && batchAbort ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            batchAbort.abort();
                            setBatchProgress(
                              t('updates.batchCancelling', { }),
                            );
                          }}
                        >
                          {t('updates.batchCancel')}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setBatchProgress(null);
                            if (!busy) setApplyLog([]);
                          }}
                        >
                          {t('common.dismiss')}
                        </Button>
                      )}
                    </div>
                  </Alert>
                ) : null}
                <InstallStreamPanel
                  lines={applyLog}
                  busy={Boolean(busy && batchProgress)}
                  title={t('updates.applyLogTitle', { })}
                />
              </div>
            ) : null}
            {busy && inventory.length === 0 ? (
              <LoadingBlock label={t('updates.scanning')} />
            ) : (
              <DataTable
                title={t('updates.inventoryTitle')}
                description={t('updates.inventoryDesc', {
                  shown: filtered.length,
                  total: filtered.length,
                  when: relTime(lastAt, t) })}
                toolbar={
                  <ActionBar align="end">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy || !filteredUpgradable.length}
                      onClick={selectAllUpgradableInFilter}
                    >
                      {t('updates.selectAllUpgradable', { })}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || selectedKeys.size === 0}
                      onClick={() => setSelectedKeys(new Set())}
                    >
                      {t('updates.clearSelection', { })}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={
                        busy || !canApply || selectedUpgradable.length === 0
                      }
                      loading={busy && batchProgress != null}
                      title={
                        !canApply
                          ? t('rbac.cap.updatesApply')
                          : selectedUpgradable.length === 0
                            ? t('updates.batchEmpty', { })
                            : undefined
                      }
                      onClick={openBatchConfirm}
                    >
                      {t('updates.updateSelected', {
                        n: selectedUpgradable.length })}
                    </Button>
                  </ActionBar>
                }
                filters={
                  <ListToolbar
                    search={q}
                    onSearchChange={setQ}
                    searchPlaceholder={t('updates.searchPh', {
                      defaultValue: t('listToolbar.searchPlaceholder') })}
                    searching={busy}
                    loading={busy}
                    total={filtered.length}
                    activeFilterCount={activeFilterCount}
                    onClear={() => {
                      setQ('');
                      setRiskFilter('all');
                    }}
                    chipGroups={[
                      {
                        key: 'risk',
                        ariaLabel: t('updates.riskFilterAria'),
                        allLabel: t('updates.all'),
                        value: riskFilter === 'all' ? '' : riskFilter,
                        onChange: (v) =>
                          setRiskFilter((v || 'all') as RiskFilter),
                        chips: [
                          {
                            id: 'upgradable',
                            label: t('updates.upgradable'),
                            count: upgradableCount },
                          {
                            id: 'high',
                            label: t('updates.highRisk'),
                            count: highRisk,
                            tone: 'danger' },
                          {
                            id: 'medium',
                            label: t('updates.mediumFilter'),
                            tone: 'warn' },
                          {
                            id: 'low',
                            label: t('updates.lowUnmarked'),
                            tone: 'ok' },
                          {
                            id: 'approval',
                            label: t('updates.needApproval'),
                            count: needApproval,
                            tone: 'warn' },
                        ] },
                    ]}
                  />
                }
                columns={[
                  {
                    key: 'sel',
                    header: (
                      <input
                        type="checkbox"
                        aria-label={t('updates.selectAllUpgradable')}
                        checked={allUpgradableSelected}
                        disabled={!filteredUpgradable.length || busy}
                        onChange={(e) => {
                          if (e.target.checked) selectAllUpgradableInFilter();
                          else setSelectedKeys(new Set());
                        }}
                      />
                    ),
                    nowrap: true,
                    render: (i) => {
                      const up = isUpgradableRow(i);
                      const k = packageRowKey(i);
                      return (
                        <input
                          type="checkbox"
                          aria-label={i.packageName}
                          disabled={!up || busy || !canApply}
                          checked={up && selectedKeys.has(k)}
                          onChange={(e) => toggleSelect(i, e.target.checked)}
                        />
                      );
                    } },
                  {
                    key: 'pkg',
                    header: t('updates.colPackage'),
                    render: (i) => (
                      <div className="upd-pkg-cell">
                        <div className="upd-pkg-cell__title">
                          <strong className="upd-pkg-cell__name">
                            {i.packageName}
                          </strong>
                          <Badge tone={riskTone(i.risk)}>
                            {riskLabel(i.risk, t)}
                          </Badge>
                          {i.requiresApproval ? (
                            <Badge tone="warn">{t('updates.needApproval')}</Badge>
                          ) : null}
                        </div>
                        {i.cves?.length ? (
                          <div className="upd-pkg-cell__cves">
                            {i.cves.slice(0, 4).map((c) => (
                              <code key={c} className="upd-pkg__cve">
                                {c}
                              </code>
                            ))}
                            {i.cves.length > 4 ? (
                              <span className="muted u-text-sm">
                                +{i.cves.length - 4}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) },
                  {
                    key: 'ver',
                    header: t('updates.colVersion'),
                    render: (i) => {
                      const cur = i.currentVersion ?? '—';
                      const cand = i.candidateVersion ?? cur;
                      const hasUpgrade = Boolean(cand && cand !== cur);
                      return (
                        <div className="upd-pkg-cell__ver">
                          <code title={t('updates.installedTitle')}>{cur}</code>
                          {hasUpgrade ? (
                            <>
                              <span className="upd-pkg__arrow">→</span>
                              <code className="upd-pkg__cand" title={t('updates.aptCandidate')}>
                                {cand}
                              </code>
                            </>
                          ) : (
                            <span className="muted u-text-sm">{t('updates.noUpgrade')}</span>
                          )}
                        </div>
                      );
                    } },
                  {
                    key: 'advice',
                    header: t('updates.colAdvice'),
                    render: (i) => {
                      // Prefer localized advice enum; summary may already be i18n from API
                      const fromEnum = adviceLabel(i.advice, t);
                      const fromSummary =
                        i.summary && i.summary !== i.advice
                          ? humanizeOperatorNote(i.summary) ?? i.summary
                          : null;
                      // If advice is enum-like, show adviceLabel; else humanize
                      const raw = (i.advice ?? '').toLowerCase();
                      const isEnum = ['update', 'skip', 'watch', 'urgent'].includes(
                        raw,
                      );
                      const text = isEnum
                        ? fromEnum
                        : fromSummary ||
                          humanizeOperatorNote(i.advice ?? '') ||
                          fromEnum;
                      return text && text !== '—' ? (
                        <span className="upd-pkg-cell__advice">{text}</span>
                      ) : (
                        <span className="muted">—</span>
                      );
                    } },
                ]}
                rows={filtered}
                rowKey={(i) => packageRowKey(i)}
                rowClassName={(i) =>
                  selectedKeys.has(packageRowKey(i)) ? 'is-selected' : undefined
                }
                rowActions={(i) => {
                  const hasUpgrade =
                    Boolean(i.candidateVersion) &&
                    i.candidateVersion !== i.currentVersion;
                  return (
                    <ActionBar align="end">
                      <Button
                        variant={
                          !hasUpgrade
                            ? 'ghost'
                            : isHighRisk(i)
                              ? 'danger'
                              : 'primary'
                        }
                        size="sm"
                        loading={busy}
                        disabled={!hasUpgrade || !canApply}
                        title={
                          !canApply
                            ? t('rbac.cap.updatesApply')
                            : hasUpgrade
                              ? t('updates.upgradeTo', { v: i.candidateVersion })
                              : t('updates.sameVersion')
                        }
                        onClick={() => {
                          if (!hasUpgrade || !canApply) return;
                          const high = isHighRisk(i);
                          if (high) {
                            setHighRiskApply(i);
                            return;
                          }
                          void applyPackage(i, false);
                        }}
                      >
                        {hasUpgrade ? t('common.apply') : t('updates.noNeedUpgrade')}
                      </Button>
                    </ActionBar>
                  );
                }}
                empty={
                  inventory.length === 0 ? (
                    <EmptyState
                      title={t('updates.emptyInventory')}
                      description={t('updates.emptyInventoryDesc')}
                    />
                  ) : (
                    <EmptyState
                      title={t('updates.emptyFilter')}
                      description={t('updates.emptyFilterDesc')}
                    />
                  )
                }
              />
            )}
          </div>
        ) : null}

        {tab === 'panel' ? (
          <div className="tab-panel">
            {!selfUpdate ? (
              <LoadingBlock label={t('updates.selfLoading')} />
            ) : (
              <InfoCardGrid cols={2}>
                <InfoCard
                  title={t('updates.selfTitle')}
                  badge={{
                    label: !selfOk
                      ? t('updates.selfCheckFailed')
                      : selfAvailable
                        ? t('updates.selfUpdatable')
                        : t('updates.selfUpToDate'),
                    tone: !selfOk ? 'danger' : selfAvailable ? 'warn' : 'ok' }}
                  facts={[
                    { label: t('updates.selfCurrentShort'), value: selfVersion, mono: true },
                    { label: t('updates.selfLatestShort'), value: selfLatest, mono: true },
                    { label: t('updates.selfChannel'), value: selfChannel },
                    ...(selfUpdate.packageName != null
                      ? [
                          {
                            label: t('updates.packages'),
                            value: String(selfUpdate.packageName),
                            mono: true as const },
                        ]
                      : []),
                    ...(Array.isArray(selfUpdate.notes) &&
                    (selfUpdate.notes as string[]).length
                      ? [
                          {
                            label: t('common.about'),
                            value: humanizeOperatorNote(
                              String((selfUpdate.notes as string[])[0]),
                            ) },
                        ]
                      : []),
                    {
                      label: t('common.status'),
                      value: !selfOk
                        ? t('updates.remoteUnknown')
                        : selfAvailable
                          ? t('updates.hasUpdate')
                          : t('updates.selfUpToDate') },
                  ]}
                  actions={
                    <ActionBar>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        disabled={!selfAvailable || !canApply}
                        title={!canApply ? t('rbac.cap.updatesApply') : undefined}
                        onClick={bindVoid(applySelf)}
                      >
                        {t('updates.applyPanelUpdate')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={bindCall1(load, false)}
                      >
                        {t('updates.recheck')}
                      </Button>
                    </ActionBar>
                  }
                />
                <InfoCard
                  title={t('common.about')}
                  facts={[
                    {
                      label: t('updates.aboutScope'),
                      value: t('updates.aboutScopeV') },
                    {
                      label: t('updates.aboutChannel'),
                      value:
                        t('updates.aboutChannelV') },
                    {
                      label: t('updates.aboutFail'),
                      value: t('updates.aboutFailV') },
                  ]}
                />
              </InfoCardGrid>
            )}
          </div>
        ) : null}

        {tab === 'schedule' ? (
          <div className="tab-panel">
            <section className="data-table">
              <header className="data-table__head">
                <div className="data-table__head-text">
                  <h3 className="data-table__title">{t('updates.jobsTitle')}</h3>
                  <p className="data-table__desc">
                    {t('updates.jobsSub', { count: jobs.length })}
                  </p>
                </div>
              </header>
              {jobs.length === 0 ? (
                <div className="data-table__empty">
                  <EmptyState
                    title={t('updates.noJobs')}
                    description={t('updates.noJobsDesc')}
                  />
                </div>
              ) : (
                <ul className="upd-job-list">
                  {jobs.map((j) => (
                    <li key={String(j.id)}>
                      <span className="upd-job__id">{String(j.id)}</span>
                      <span className="upd-job__meta">
                        {j.intervalMs != null
                          ? `${j.intervalMs}ms`
                          : j.interval
                            ? String(j.interval)
                            : '—'}
                        {j.lastRunAt
                          ? t('updates.lastRun', {
                              when: relTime(String(j.lastRunAt), t) })
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        {tab === 'policy' ? (
          <div className="tab-panel stack">
            <InfoCard
              title={t('updates.policyTitle')}
              facts={[
                {
                  label: t('updates.scanPolicy'),
                  value: t('updates.scanPolicyV') },
                {
                  label: t('updates.highRisk'),
                  value: t('updates.highRiskPolicyV') },
                {
                  label: t('updates.permPolicy'),
                  value: t('updates.permPolicyV') },
                {
                  label: 'OSV',
                  value: t('updates.osvPolicyV') },
              ]}
            />
            <nav className="upd-shortcuts" aria-label={t('updates.relatedAria')}>
              <Link to="/system" className="upd-shortcut">
                <span className="upd-shortcut__t">{t('updates.scHost')}</span>
                <span className="upd-shortcut__d">EXECUTE / root</span>
              </Link>
              <Link to="/system/readiness" className="upd-shortcut">
                <span className="upd-shortcut__t">{t('updates.scReadiness')}</span>
                <span className="upd-shortcut__d">{t('updates.scReadinessD')}</span>
              </Link>
              <Link to="/system/unit" className="upd-shortcut">
                <span className="upd-shortcut__t">{t('updates.scSystemd')}</span>
                <span className="upd-shortcut__d">{t('updates.scSystemdD')}</span>
              </Link>
              <Link to="/security" className="upd-shortcut">
                <span className="upd-shortcut__t">{t('updates.scSecurity')}</span>
                <span className="upd-shortcut__d">{t('updates.scSecurityD')}</span>
              </Link>
            </nav>
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="updates" /> : null}
      </PageTabs>

      <ConfirmDialog
        open={highRiskApply != null}
        onClose={bindSet(setHighRiskApply, null)}
        title={
          highRiskApply
            ? t('updates.applyHighRisk', { name: highRiskApply.packageName })
            : t('updates.highRiskUpdate')
        }
        description={
          highRiskApply
            ? `${highRiskApply.currentVersion} → ${highRiskApply.candidateVersion}. ${
                highRiskApply.summary
                  ? humanizeOperatorNote(highRiskApply.summary) ??
                    highRiskApply.summary
                  : adviceLabel(highRiskApply.advice, t)
              }`
            : ''
        }
        confirmLabel={t('common.apply')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => {
          const row = highRiskApply;
          setHighRiskApply(null);
          if (row) void applyPackage(row, true);
        }}
      />

      <ConfirmDialog
        open={batchConfirmOpen}
        onClose={() => {
          if (!busy) setBatchConfirmOpen(false);
        }}
        title={t('updates.batchConfirmTitle', { })}
        description={
          t('updates.batchConfirmBody', {
            n: selectedUpgradable.length }) +
          (selectedHasHighRisk
            ? '\n\n' +
              t('updates.batchConfirmHighRisk', { })
            : '') +
          '\n\n' +
          selectedUpgradable
            .slice(0, 12)
            .map(
              (r) =>
                `• ${r.packageName}: ${r.currentVersion} → ${r.candidateVersion}`,
            )
            .join('\n') +
          (selectedUpgradable.length > 12
            ? `\n… +${selectedUpgradable.length - 12}`
            : '')
        }
        confirmLabel={t('updates.updateSelected', {
          n: selectedUpgradable.length })}
        cancelLabel={t('common.cancel')}
        danger={selectedHasHighRisk}
        busy={busy}
        onConfirm={() => void runBatchApply()}
      />
    </FeaturePageLayout>
  );
}
