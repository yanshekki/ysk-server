/**
 * Smart updates — tabbed: packages · panel self · schedule · about.
 * Inventory filters are server-backed (ListQuery on GET /updates/inventory).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUpdates, updatesApi } from '../features/updates';
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
  InfoCard,
  InfoCardGrid,
  ListToolbar,
  LoadingBlock,
  PageTabs } from '../shared/components/ui';
import { usePageTab } from '../shared/hooks/usePageTab';
import { useOpsStreamOptional } from '../shared/ops-stream/OpsStreamContext';
import { useCapabilities } from '../shared/hooks/useCapabilities';
import { formatDateTime } from '../shared/lib/datetime';
import { humanizeOperatorNote } from '../shared/lib/operator-messages';
import { toast } from '../shared/stores/toast-store';
import { bindAllOrValue, bindCall1, bindCall2, bindCloseIfIdle, bindInput, bindSet, bindValueSet, bindVoid } from './bind-handlers';

const UPD_TABS = [
  'overview',
  'available',
  'services',
  'runtime',
  'packages',
  'panel',
  'schedule',
  'about',
] as const;
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

export function isKernelPackage(name: string | undefined): boolean {
  return /^linux(-image|-headers|-modules|-generic|-tools|-libc|-virtual)/i.test(name ?? '');
}

/** Strip "PHP 8.3.6 (cli) (built: …)" → "8.3.6". */
export function shortVersion(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s || s === '—') return '—';
  const m = s.match(/v?(\d+\.\d+(?:\.\d+)?[a-z0-9._-]*)/i);
  return m?.[1] ? (s.startsWith('v') && m[0].startsWith('v') ? `v${m[1]}` : m[1]) : s;
}

export function formatIntervalMs(
  ms: number,
  tr: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms % 86_400_000 === 0) {
    const n = ms / 86_400_000;
    return n === 1 ? tr('updates.intervalDay') : tr('updates.intervalDays', { n });
  }
  if (ms % 3_600_000 === 0) {
    const n = ms / 3_600_000;
    return n === 1 ? tr('updates.intervalHour') : tr('updates.intervalHours', { n });
  }
  if (ms % 60_000 === 0) {
    const n = ms / 60_000;
    return tr('updates.intervalMinutes', { n });
  }
  if (ms % 1000 === 0) return tr('updates.intervalSeconds', { n: ms / 1000 });
  return `${ms}ms`;
}

export function versionArrow(
  current: string | null | undefined,
  latest: string | null | undefined,
): string {
  const cur = current?.trim() || '—';
  const lat = latest?.trim() || '—';
  if (cur === '—' && lat === '—') return '—';
  if (cur === lat || !latest) return cur;
  return `${cur} → ${lat}`;
}

export function looksLikeProbeError(s?: string): boolean {
  return Boolean(s && /error:|rustup|could not|wasn't specified|no default/i.test(s));
}

export function jobI18nKey(id: string): string {
  return `updates.job.${String(id).replace(/[.-]/g, '_')}`;
}

export function isHighRisk(row: AdviceRow): boolean {
  return (
    row.risk === 'high' ||
    row.risk === 'critical' ||
    Boolean(row.requiresApproval) ||
    isKernelPackage(row.packageName)
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
    return formatDateTime(iso);
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
  const stream = useOpsStreamOptional();
  const {
    inventory,
    entries,
    selfUpdate,
    lastAt,
    jobs,
    busy,
    load,
    applySelf,
    applyPackage,
    applyPackages } = useUpdates();

  const [tab, setTab] = usePageTab(UPD_TABS, 'overview');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [summary, setSummary] = useState<{
    lastScanAt?: string | null;
    nextScanAt?: string | null;
    autoScanEnabled?: boolean;
    intervalMs?: number;
    packagesUpgradable?: number;
    packagesHighRisk?: number;
    panelUpdateAvailable?: boolean;
    panelCurrent?: string;
    panelLatest?: string;
    badgeCount?: number;
    stale?: boolean;
  } | null>(null);
  const [osvChecked, setOsvChecked] = useState(false);
  const [scanEnabled, setScanEnabled] = useState(true);
  const [scanIntervalMs, setScanIntervalMs] = useState(24 * 60 * 60_000);
  const [searchParams] = useSearchParams();
  const qFromUrl = (searchParams.get('q') ?? '').trim();
  const [q, setQ] = useState(qFromUrl);
  const [debouncedQ, setDebouncedQ] = useState(qFromUrl);
  const [highRiskApply, setHighRiskApply] = useState<AdviceRow | null>(null);
  const [pkgPage, setPkgPage] = useState(0);
  const PKG_PAGE = 50;
  /** Selected package row keys for bulk update */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  /** Soft-cancel sequential fallback between packages */
  const [batchAbort, setBatchAbort] = useState<AbortController | null>(null);

  // Deep-link: /updates?q=nginx → packages tab + search
  useEffect(() => {
    if (qFromUrl && qFromUrl !== q) {
      setQ(qFromUrl);
      setDebouncedQ(qFromUrl);
      setTab('packages');
    }
    // Only re-sync when URL q changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qFromUrl]);

  const refreshSummary = async () => {
    try {
      const s = await updatesApi.summary();
      setSummary(s);
      if (typeof s.autoScanEnabled === 'boolean') setScanEnabled(s.autoScanEnabled);
      if (typeof s.intervalMs === 'number') setScanIntervalMs(s.intervalMs);
    } catch {
      /* optional */
    }
  };

  useEffect(() => {
    void refreshSummary();
    void updatesApi
      .scanSettings()
      .then((r) => {
        if (r.settings) {
          setScanEnabled(r.settings.enabled);
          setScanIntervalMs(r.settings.intervalMs);
        }
      })
      .catch(() => undefined);
  }, []);

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

  useEffect(() => {
    setPkgPage(0);
  }, [debouncedQ, riskFilter]);

  // Server-backed filter: reload when listQuery changes (after first mount load from hook)
  useEffect(() => {
    void load(false, false, listQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when filters change
  }, [listQuery]);

  const [statsSnap, setStatsSnap] = useState<{
    pkgs: number;
    up: number;
    high: number;
    cve: number;
  } | null>(null);

  useEffect(() => {
    if (riskFilter !== 'all' || debouncedQ || !inventory.length) return;
    setStatsSnap({
      pkgs: inventory.length,
      up: inventory.filter((i) => i.candidateVersion && i.candidateVersion !== i.currentVersion)
        .length,
      high: inventory.filter((i) => i.risk === 'critical' || i.risk === 'high').length,
      cve: inventory.filter((i) => (i.cves?.length ?? 0) > 0).length,
    });
  }, [inventory, riskFilter, debouncedQ]);

  const highRisk = statsSnap?.high ?? inventory.filter(
    (i) => i.risk === 'critical' || i.risk === 'high',
  ).length;
  const needApproval = inventory.filter((i) => i.requiresApproval).length;
  const withCve = statsSnap?.cve ?? inventory.filter((i) => (i.cves?.length ?? 0) > 0).length;

  const selfAvailable = Boolean(selfUpdate?.updateAvailable);
  const selfVersion = String(selfUpdate?.currentVersion ?? '—');
  const selfLatest = String(selfUpdate?.latestVersion ?? '—');
  const selfChannel = String(selfUpdate?.channel ?? '—');
  const selfChecked = selfUpdate?.checked !== false;
  const selfOk = selfUpdate?.ok !== false && selfChecked;

  const heroTone = highRisk > 0 ? 'danger' : selfAvailable ? 'warn' : 'ok';

  const upgradableCount =
    summary?.packagesUpgradable ??
    statsSnap?.up ??
    inventory.filter(
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
    const started = stream?.begin({
      kind: 'apply',
      title: t('updates.batchProgress', {
        n: 0,
        total: rows.length,
        pkg: rows[0]?.packageName ?? '',
      }),
    });
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
        signal: started?.signal ?? ac.signal,
        onLog: (line) => {
          if (started && stream) stream.appendLog(started.id, line);
        },
        onProgress: (n, total, pkg) => {
          const msg = t('updates.batchProgress', {
            n,
            total,
            pkg });
          setBatchProgress(msg);
          if (started && stream) {
            stream.appendLog(started.id, { stream: 'status', line: msg });
          }
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
      if (started && stream) {
        stream.finish(started.id, {
          ok: result.fail.length === 0,
          error: result.fail.length
            ? t('updates.batchPartialFail', {
                list: result.fail
                  .slice(0, 5)
                  .map((f) => `${f.pkg}: ${f.message}`)
                  .join('；'),
              })
            : undefined,
        });
      }
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
          { label: t('updates.packages'), value: statsSnap?.pkgs ?? inventory.length },
          {
            label: t('updates.highRisk'),
            value: highRisk,
            tone: highRisk > 0 ? 'danger' : 'ok' },
          {
            label: t('updates.needApproval'),
            value: (
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setTab('available');
                  setRiskFilter('approval');
                }}
              >
                {needApproval}
              </button>
            ),
            tone: needApproval > 0 ? 'warn' : 'neutral',
            hint: t('updates.needApprovalHint'),
          },
          {
            label: t('updates.cveLabel'),
            value: osvChecked ? String(withCve) : t('updates.cveNotChecked'),
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
            onClick={() => {
              setOsvChecked(true);
              bindCall2(load, true, true)();
            }}
            title={t('updates.osvTitle')}
          >
            {t('updates.scanOsvN', { n: 12, defaultValue: t('updates.scanOsv') })}
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

      <PageTabs
        tabs={[
          {
            id: 'overview',
            label: t('updates.tabOverview'),
            badge: summary?.badgeCount || undefined },
          {
            id: 'available',
            label: t('updates.upgradable'),
            badge: upgradableCount || undefined },
          {
            id: 'services',
            label: t('updates.groupService'),
            badge:
              entries.filter((e) => e.group === 'service' && e.upgradable).length ||
              undefined },
          {
            id: 'runtime',
            label: t('updates.groupRuntime'),
            badge:
              entries.filter((e) => e.group === 'runtime' && e.upgradable).length ||
              undefined },
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
            badge: summary?.autoScanEnabled === false ? t('updates.disabled') : undefined },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'overview' ? (
          <div className="tab-panel stack">
            <Alert variant={summary?.stale ? 'warn' : 'info'}>
              {summary?.stale
                ? t('updates.overviewStale')
                : t('updates.overviewHint')}
            </Alert>
            <InfoCardGrid>
              <InfoCard
                title={t('updates.lastScan')}
                facts={[
                  {
                    label: t('updates.lastScan'),
                    value: relTime(summary?.lastScanAt ?? lastAt, t),
                  },
                  {
                    label: t('updates.nextScan'),
                    value: summary?.nextScanAt
                      ? formatDateTime(summary.nextScanAt)
                      : '—',
                  },
                  {
                    label: t('updates.autoScan'),
                    value: summary?.autoScanEnabled === false
                      ? t('updates.disabled')
                      : t('updates.enabled'),
                  },
                ]}
              />
              <InfoCard
                title={t('updates.packages')}
                facts={[
                  {
                    label: t('updates.upgradable'),
                    value: String(upgradableCount ?? 0),
                  },
                  {
                    label: t('updates.highRisk'),
                    value: String(highRisk),
                  },
                ]}
              />
              <InfoCard
                title={t('updates.panel')}
                facts={[
                  {
                    label: t('updates.selfCurrent'),
                    value: selfVersion,
                  },
                  {
                    label: t('updates.selfLatest'),
                    value: selfLatest,
                  },
                  {
                    label: t('updates.status'),
                    value: selfAvailable
                      ? t('updates.selfAvailable')
                      : t('updates.selfUpToDate'),
                  },
                ]}
              />
            </InfoCardGrid>
            <ActionBar>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                onClick={() => {
                  void load(true, false).then(() => refreshSummary());
                }}
              >
                {t('updates.scanNow')}
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setRiskFilter('upgradable');
                  setTab('packages');
                }}
              >
                {t('updates.viewUpgradable')}
              </Button>
              {(summary?.panelUpdateAvailable || selfAvailable) && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setTab('panel')}
                >
                  {t('updates.tabSelf')}
                </Button>
              )}
            </ActionBar>
            <p className="muted u-text-sm">{t('updates.installElsewhere')}</p>
          </div>
        ) : null}

        {tab === 'available' || tab === 'services' || tab === 'runtime' ? (
          <div className="tab-panel stack">
            <DataTable
              title={
                tab === 'available'
                  ? t('updates.upgradable')
                  : tab === 'services'
                    ? t('updates.groupService')
                    : t('updates.groupRuntime')
              }
              description={
                tab === 'available'
                  ? t('updates.availableHint')
                  : tab === 'services'
                    ? t('updates.servicesHint')
                    : t('updates.runtimeHint')
              }
              rows={entries.filter((e) => {
                if (tab === 'available') return e.upgradable;
                if (tab === 'services') return e.group === 'service';
                return e.group === 'runtime';
              })}
              rowKey={(e) => e.id}
              empty={
                <EmptyState
                  title={t('updates.emptyInventory')}
                  description={t('updates.emptyInventoryDesc')}
                />
              }
              columns={[
                {
                  key: 'title',
                  header: t('updates.colPackage'),
                  mobile: 'lead',
                  render: (e) => (
                    <span>
                      {e.title}
                      {!e.installed ? (
                        <Badge tone="neutral">{t('updates.notInstalled')}</Badge>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: 'ver',
                  header: t('updates.colVersion'),
                  mobile: 'meta',
                  render: (e) => {
                    if (looksLikeProbeError(e.currentVersion) || looksLikeProbeError(e.latestVersion)) {
                      const raw = e.currentVersion || e.latestVersion || '';
                      return (
                        <details>
                          <summary>
                            <Badge tone="warn">{t('updates.probeFailed')}</Badge>
                          </summary>
                          <pre className="u-text-sm u-mt-1">{raw}</pre>
                        </details>
                      );
                    }
                    const cur = shortVersion(e.currentVersion);
                    const lat = e.latestVersion ? shortVersion(e.latestVersion) : '';
                    const same = Boolean(lat) && lat === cur;
                    if (!lat) {
                      return (
                        <span title={tab === 'runtime' ? t('updates.notViaApt') : t('updates.noCandidate')}>
                          <code>{cur}</code>{' '}
                          <span className="muted u-text-sm">{t('updates.noCandidate')}</span>
                        </span>
                      );
                    }
                    if (same) {
                      return (
                        <span>
                          <code>{cur}</code>{' '}
                          <span className="muted u-text-sm">{t('updates.noUpgrade')}</span>
                        </span>
                      );
                    }
                    return (
                      <span>
                        <code>{cur}</code>
                        <span className="upd-pkg__arrow"> → </span>
                        <code>{lat}</code>
                      </span>
                    );
                  },
                },
                {
                  key: 'kind',
                  header: t('updates.colAdvice'),
                  mobile: 'hide',
                  render: (e) =>
                    t(`updates.kind.${e.kind}`, { defaultValue: e.kind }),
                },
                {
                  key: 'act',
                  header: t('common.actions'),
                  mobile: 'actions',
                  render: (e) => (
                    <ActionBar>
                      {e.applyPath === 'apt' && e.upgradable && canApply ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          title={
                            isKernelPackage(e.packageName || e.title)
                              ? t('updates.kernelRebootHint')
                              : t('updates.applyNeedConfirm')
                          }
                          variant={
                            isHighRisk({
                              packageName: e.packageName || e.title,
                              currentVersion: e.currentVersion || '',
                              candidateVersion: e.latestVersion,
                              risk: e.risk,
                              requiresApproval: e.requiresApproval,
                            })
                              ? 'danger'
                              : 'secondary'
                          }
                          onClick={() => {
                            const row = {
                              packageName: e.packageName || '',
                              currentVersion: e.currentVersion || '',
                              candidateVersion: e.latestVersion,
                              risk: e.risk,
                              requiresApproval: e.requiresApproval,
                              summary: e.summary,
                            };
                            setHighRiskApply(row);
                          }}
                        >
                          {t('updates.applyPkg')}
                          {isKernelPackage(e.packageName || e.title)
                            ? ` · ${t('updates.rebootNeeded')}`
                            : ''}
                        </Button>
                      ) : null}
                      {e.applyPath === 'panel' && e.upgradable && canApply ? (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busy}
                          onClick={bindVoid(applySelf)}
                        >
                          {t('updates.applyPanelUpdate')}
                        </Button>
                      ) : null}
                      <Link
                        className="btn btn--ghost btn--sm"
                        to={e.href}
                        title={t('updates.goToPage')}
                      >
                        {t('updates.goToPage')}
                      </Link>
                    </ActionBar>
                  ),
                },
              ]}
            />
          </div>
        ) : null}
        {tab === 'packages' ? (
          <div className="tab-panel stack">
            {busy && batchAbort ? (
              <ActionBar>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    batchAbort.abort();
                    stream?.requestCancel();
                    setBatchProgress(t('updates.batchCancelling'));
                  }}
                >
                  {t('updates.batchCancel')}
                </Button>
              </ActionBar>
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
                    mobile: 'check',
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
                    mobile: 'lead',
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
                          {isKernelPackage(i.packageName) ? (
                            <Badge tone="warn">{t('updates.needsReboot')}</Badge>
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
                    mobile: 'meta',
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
                    mobile: 'hide',
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
                rows={filtered.slice(pkgPage * PKG_PAGE, (pkgPage + 1) * PKG_PAGE)}
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
                            : !hasUpgrade
                              ? t('updates.sameVersion')
                              : isHighRisk(i)
                                ? t('updates.applyNeedConfirm')
                                : t('updates.upgradeTo', { v: i.candidateVersion })
                        }
                        onClick={() => {
                          if (!hasUpgrade || !canApply) return;
                          setHighRiskApply(i);
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
            {filtered.length > PKG_PAGE ? (
              <ActionBar>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pkgPage === 0}
                  onClick={() => setPkgPage((p) => Math.max(0, p - 1))}
                >
                  {t('common.previous')}
                </Button>
                <span className="muted u-text-sm">
                  {pkgPage * PKG_PAGE + 1}–{Math.min(filtered.length, (pkgPage + 1) * PKG_PAGE)} / {filtered.length}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={(pkgPage + 1) * PKG_PAGE >= filtered.length}
                  onClick={() => setPkgPage((p) => p + 1)}
                >
                  {t('common.next')}
                </Button>
              </ActionBar>
            ) : null}
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
                        title={
                          !canApply
                            ? t('rbac.cap.updatesApply')
                            : !selfAvailable
                              ? t('updates.applyPanelAlreadyLatest')
                              : t('updates.applyPanelUpdate')
                        }
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
          <div className="tab-panel stack">
            <section className="upd-panel" aria-labelledby="upd-scan-sched">
              <header className="upd-panel__head">
                <div>
                  <h3 id="upd-scan-sched" className="upd-panel__title">
                    {t('updates.scheduleTitle')}
                  </h3>
                  <p className="upd-panel__sub">{t('updates.scheduleDesc')}</p>
                </div>
              </header>
              <div className="stack u-gap-3">
                <label className="u-flex u-items-center u-gap-2">
                  <input
                    type="checkbox"
                    checked={scanEnabled}
                    onChange={(e) => setScanEnabled(e.target.checked)}
                  />
                  <span>{t('updates.autoScanEnable')}</span>
                </label>
                <label className="stack u-gap-1">
                  <span className="muted u-text-sm">{t('updates.scanInterval')}</span>
                  <select
                    value={String(scanIntervalMs)}
                    onChange={(e) => setScanIntervalMs(Number(e.target.value))}
                    className="u-input u-w-control-xl"
                  >
                    <option value={String(6 * 60 * 60_000)}>{t('updates.interval6h')}</option>
                    <option value={String(12 * 60 * 60_000)}>{t('updates.interval12h')}</option>
                    <option value={String(24 * 60 * 60_000)}>{t('updates.interval24h')}</option>
                    <option value={String(48 * 60 * 60_000)}>{t('updates.interval48h')}</option>
                  </select>
                </label>
                <ActionBar>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy}
                    onClick={() => {
                      void updatesApi
                        .patchScanSettings({
                          enabled: scanEnabled,
                          intervalMs: scanIntervalMs,
                        })
                        .then(() => {
                          toast.ok(t('updates.scheduleSaved'));
                          return refreshSummary();
                        })
                        .catch((e: Error) => toast.error(e.message));
                    }}
                  >
                    {t('updates.saveSchedule')}
                  </Button>
                </ActionBar>
              </div>
            </section>
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
                      <span className="upd-job__id" title={t(`${jobI18nKey(String(j.id))}.hint`, { defaultValue: String(j.id) })}>
                        {t(`${jobI18nKey(String(j.id))}.name`, { defaultValue: String(j.id) })}
                      </span>
                      <span className="upd-job__meta">
                        {[
                          j.intervalMs != null
                            ? formatIntervalMs(Number(j.intervalMs), t)
                            : j.interval
                              ? String(j.interval)
                              : '',
                          j.lastRunAt ||
                          (String(j.id) === 'updates.scan' && (summary?.lastScanAt ?? lastAt))
                            ? t('updates.lastRun', {
                                when: relTime(
                                  String(
                                    j.lastRunAt ||
                                      summary?.lastScanAt ||
                                      lastAt,
                                  ),
                                  t,
                                ),
                              })
                            : t('updates.neverRun'),
                        ]
                          .map((s) => String(s || '').trim())
                          .filter(Boolean)
                          .join(' · ')}
                        {String(j.id) === 'defense-geoip-update' &&
                        !(j.lastRunAt) ? (
                          <>
                            {' · '}
                            <Link to="/protection?tab=geo">{t('updates.jobOpenGeo')}</Link>
                          </>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        {tab === 'about' ? (
          <div className="tab-panel stack">
            <section className="upd-panel upd-panel--primary" aria-labelledby="upd-about-policy">
              <header className="upd-panel__head">
                <div>
                  <h3 id="upd-about-policy" className="upd-panel__title">
                    {t('updates.policyTitle')}
                  </h3>
                  <p className="upd-panel__sub">{t('updates.aboutPolicySub')}</p>
                </div>
              </header>
              <ol className="upd-policy">
                <li className="upd-policy__item">
                  <span className="upd-policy__n" aria-hidden>1</span>
                  <div className="upd-policy__body">
                    <div className="upd-policy__title">{t('updates.scanPolicy')}</div>
                    <p className="upd-policy__text">{t('updates.scanPolicyV')}</p>
                  </div>
                </li>
                <li className="upd-policy__item">
                  <span className="upd-policy__n" aria-hidden>2</span>
                  <div className="upd-policy__body">
                    <div className="upd-policy__title">{t('updates.highRisk')}</div>
                    <p className="upd-policy__text">{t('updates.highRiskPolicyV')}</p>
                  </div>
                </li>
                <li className="upd-policy__item">
                  <span className="upd-policy__n" aria-hidden>3</span>
                  <div className="upd-policy__body">
                    <div className="upd-policy__title">{t('updates.permPolicy')}</div>
                    <p className="upd-policy__text">{t('updates.permPolicyV')}</p>
                  </div>
                </li>
                <li className="upd-policy__item">
                  <span className="upd-policy__n" aria-hidden>4</span>
                  <div className="upd-policy__body">
                    <div className="upd-policy__title">OSV</div>
                    <p className="upd-policy__text">{t('updates.osvPolicyV')}</p>
                  </div>
                </li>
              </ol>
            </section>

            <section className="upd-panel" aria-labelledby="upd-about-guide">
              <header className="upd-panel__head">
                <h3 id="upd-about-guide" className="upd-panel__title">
                  {t('common.about')}
                </h3>
              </header>
              <PageGuide guideId="updates" />
            </section>
          </div>
        ) : null}
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
                isKernelPackage(highRiskApply.packageName)
                  ? t('updates.kernelRebootWarn') + ' '
                  : ''
              }${
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
