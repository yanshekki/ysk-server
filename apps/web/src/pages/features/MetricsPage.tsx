/**
 * Host metrics — tabbed ops console with live process table (batch top/ps stream).
 * Live tab: full top(1) header (per-cpu "1"), filter, select, TERM/KILL.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  LoadingBlock,
  Modal,
  OpsResultPanel,
  PageTabs,
  buttonClassName,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import {
  metricsApi,
  type MetricsSnapshot,
  type ProcessSnapshot,
  type ProcessRow,
  type ProcessSort,
  type ProcessSignal,
  type SignalProcessResult,
  type ProcessDetail,
  type ProjectDiskUsageRow,
  type ProjectsDiskUsageSnapshot,
} from '../../features/metrics/api';
import { bindSet, bindInput, bindCheck, bindVoid, bindCall1, bindCall2 } from '../bind-handlers';
import {
  TopHeaderPanel,
  formatRes,
} from '../../features/metrics/TopHeaderPanel';

const MET_TABS = ['overview', 'live', 'storage', 'projects', 'alerts', 'about'] as const;

type QuickFilter = 'none' | 'mine' | 'cpu5' | 'mem5';

type PendingSignal = {
  pid: string;
  signal: ProcessSignal;
  command: string;
};

export function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatUptime(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function alertLabel(a: string, tr: (k: string) => string): string {
  const key = `metrics.alert.${a}`;
  const v = tr(key);
  return v === key ? a : v;
}

/** CPU % badge tone. */
export function cpuTone(pct: number): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (!Number.isFinite(pct)) return 'neutral';
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warn';
  return 'ok';
}

/** Memory % badge tone. */
export function memTone(pct: number): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (!Number.isFinite(pct)) return 'neutral';
  if (pct >= 90) return 'danger';
  if (pct >= 75) return 'warn';
  return 'ok';
}

/** Clamp live refresh interval to 1–60s. */
export function clampRefreshInterval(sec: unknown): number {
  const n = Number(sec);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(60, Math.floor(n)));
}

/** Toggle pid membership in a selection set. */
export function togglePid(prev: Set<string>, pid: string): Set<string> {
  const next = new Set(prev);
  if (next.has(pid)) next.delete(pid);
  else next.add(pid);
  return next;
}

/** Match process row against search + quick filter. */
export function matchProcessRow(
  row: { user?: string; command?: string; cpu?: number; mem?: number },
  search: string,
  quick: QuickFilter,
  selfUser?: string,
): boolean {
  const q = search.trim().toLowerCase();
  if (q) {
    const hay = `${row.user ?? ''} ${row.command ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (quick === 'mine' && selfUser && row.user !== selfUser) return false;
  if (quick === 'cpu5' && (row.cpu ?? 0) < 5) return false;
  if (quick === 'mem5' && (row.mem ?? 0) < 5) return false;
  return true;
}

/** Format percent for strip display. */
export function formatPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

/** Load average compact label. */
export function formatLoadAvg(
  load: number[] | null | undefined,
): string {
  if (!load?.length) return '—';
  return load.slice(0, 3).map((x) => x.toFixed(2)).join(' · ');
}

export function MetricsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(MET_TABS, 'overview');
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [processes, setProcesses] = useState<ProcessSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [follow, setFollow] = useState(false);
  const [intervalSec, setIntervalSec] = useState(2);
  const [sort, setSort] = useState<ProcessSort>('cpu');
  const [limit, setLimit] = useState(40);
  const [showRawTop, setShowRawTop] = useState(false);
  const [perCpu, setPerCpu] = useState(false);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const streamRef = useRef<AbortController | null>(null);
  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState<QuickFilter>('none');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<PendingSignal | null>(null);
  const [signalBusy, setSignalBusy] = useState(false);
  const [lastSignal, setLastSignal] = useState<SignalProcessResult | null>(null);
  const [detailPid, setDetailPid] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [niceVal, setNiceVal] = useState('0');
  const [projectUsage, setProjectUsage] =
    useState<ProjectsDiskUsageSnapshot | null>(null);
  const [projectUsageLoading, setProjectUsageLoading] = useState(false);
  const [projectUsageErr, setProjectUsageErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const m = await metricsApi.snapshot();
      setMetrics(m);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('metrics.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProjectUsage = useCallback(async () => {
    setProjectUsageLoading(true);
    setProjectUsageErr(null);
    try {
      const snap = await metricsApi.projectsUsage({ limit: 50 });
      setProjectUsage(snap);
    } catch (e) {
      setProjectUsageErr(e instanceof Error ? e.message : t('metrics.projectUsageFailed'));
    } finally {
      setProjectUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'projects' || tab === 'storage' || tab === 'overview') {
      void refreshProjectUsage();
    }
  }, [tab, refreshProjectUsage]);

  const refreshProcesses = useCallback(async () => {
    try {
      const p = await metricsApi.processes({
        sort,
        limit,
        top: showRawTop,
        header: true,
      });
      setProcesses(p);
      setStreamErr(p.ok ? null : p.notes?.[0] ?? t('metrics.procListFailed'));
    } catch (e) {
      setStreamErr(e instanceof Error ? e.message : t('metrics.procListFailed'));
    }
  }, [sort, limit, showRawTop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Overview auto-refresh
  useEffect(() => {
    if (!autoRefresh || tab !== 'overview') return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [autoRefresh, tab, refresh]);

  // Live stream only on live tab
  useEffect(() => {
    if (tab !== 'live') {
      streamRef.current?.abort();
      streamRef.current = null;
      setFollow(false);
      return;
    }
    void refreshProcesses();
  }, [tab, refreshProcesses]);

  useEffect(() => {
    if (tab !== 'live' || !follow) {
      streamRef.current?.abort();
      streamRef.current = null;
      return;
    }
    streamRef.current?.abort();
    setStreamErr(null);
    let ac: AbortController;
    try {
      ac = metricsApi.openStream({
        interval: intervalSec,
        sort,
        limit,
        // structured topHeader always; raw dump only when raw top on
        top: showRawTop,
        onTick: (t) => {
          if (t.metrics) setMetrics(t.metrics);
          if (t.processes) {
            setProcesses((prev) => {
              // Keep last topHeader if tick omitted (shouldn't)
              if (t.processes.topHeader) return t.processes;
              if (t.topHeader) return { ...t.processes, topHeader: t.topHeader };
              if (prev?.topHeader && !t.processes.topHeader) {
                return { ...t.processes, topHeader: prev.topHeader };
              }
              return t.processes;
            });
          }
          setStreamErr(null);
          setLoading(false);
        },
        onError: (msg) => {
          setStreamErr(msg);
          setFollow(false);
        },
        onEnd: (reason) => {
          setFollow(false);
          if (reason && reason !== 'http_error') {
            setStreamErr((e) => e ?? t('metrics.streamEnded', { reason }));
          }
        },
      });
    } catch (e) {
      setFollow(false);
      setStreamErr(e instanceof Error ? e.message : t('metrics.streamOpenFailed'));
      return;
    }
    streamRef.current = ac;
    return () => {
      ac.abort();
    };
  }, [tab, follow, intervalSec, sort, limit, showRawTop]);

  const loadavg = metrics?.loadavg ?? null;
  const mem = metrics?.memory ?? null;
  const disk = metrics?.disk ?? null;
  const mounts = metrics?.diskMounts ?? [];
  const alerts = metrics?.alerts ?? [];
  const memPct = mem?.usedRatio != null ? Math.round(mem.usedRatio * 100) : null;
  const diskPct = disk?.usedRatio != null ? Math.round(disk.usedRatio * 100) : null;
  const cpuCount = metrics?.cpuCount ?? 0;
  const uptimeSec = metrics?.uptimeSec;
  const load1 = loadavg?.[0];
  const loadPressure = load1 != null && cpuCount > 0 ? load1 / cpuCount : null;

  const heroTone =
    alerts.length > 0 ||
    (memPct != null && memPct >= 90) ||
    (diskPct != null && diskPct >= 90)
      ? 'danger'
      : (memPct != null && memPct >= 75) ||
          (diskPct != null && diskPct >= 75) ||
          (loadPressure != null && loadPressure > 1.5)
        ? 'warn'
        : 'ok';

  const rows: ProcessRow[] = processes?.rows ?? [];

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (quick === 'cpu5' && r.cpu < 5) return false;
      if (quick === 'mem5' && r.mem < 5) return false;
      if (quick === 'mine') {
        // best-effort: match common desktop user names when available
        const u = r.user.toLowerCase();
        if (u === 'root' || u === 'nobody' || u === 'www-data' || u === 'systemd+' || u.startsWith('systemd')) {
          return false;
        }
      }
      if (!q) return true;
      return (
        r.pid.includes(q) ||
        r.user.toLowerCase().includes(q) ||
        r.command.toLowerCase().includes(q)
      );
    });
  }, [rows, search, quick]);

  const toggleSelect = useCallback((pid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelected((prev) => {
      const allSelected =
        filteredRows.length > 0 && filteredRows.every((r) => prev.has(r.pid));
      if (allSelected) return new Set();
      return new Set(filteredRows.map((r) => r.pid));
    });
  }, [filteredRows]);

  const openSignal = useCallback(
    (pid: string, signal: ProcessSignal) => {
      const row = rows.find((r) => r.pid === pid);
      setPending({
        pid,
        signal,
        command: row?.command ?? detail?.command ?? '—',
      });
    },
    [rows, detail?.command],
  );

  const runSignal = useCallback(async () => {
    if (!pending) return;
    setSignalBusy(true);
    try {
      const result = await metricsApi.signal({
        pid: pending.pid,
        signal: pending.signal,
        confirmKill: pending.signal === 'KILL' ? true : undefined,
      });
      setLastSignal(result);
      if (result.ok && !result.stillAlive) {
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(pending.pid);
          return next;
        });
      }
      if (!follow) {
        void refreshProcesses();
      }
    } catch (e) {
      setLastSignal({
        ok: false,
        pid: pending.pid,
        signal: pending.signal,
        notes: [e instanceof Error ? e.message : t('metrics.signalFailed')],
      });
    } finally {
      setSignalBusy(false);
      setPending(null);
    }
  }, [pending, follow, refreshProcesses]);

  const openDetail = useCallback(async (pid: string) => {
    setDetailPid(pid);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await metricsApi.processDetail(pid);
      setDetail(d);
    } catch (e) {
      setDetail({
        ok: false,
        pid,
        notes: [e instanceof Error ? e.message : t('metrics.detailFailed')],
      });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const primarySelected = useMemo(() => {
    if (selected.size === 0) return null;
    // Prefer last-clicked style: use first in table order among selected
    const hit = filteredRows.find((r) => selected.has(r.pid));
    return hit ?? rows.find((r) => selected.has(r.pid)) ?? null;
  }, [selected, filteredRows, rows]);

  const isControlPlaneRow = useCallback((r: ProcessRow) => {
    const c = r.command.toLowerCase();
    return (
      c.includes('ysk-server') ||
      c.includes('@ysk/server') ||
      /node.*apps\/server/.test(c)
    );
  }, []);

  return (
    <FeaturePageLayout
      title={t('nav.metrics')}
      showCapability={false}
      status={
        metrics
          ? {
              pill: {
                label:
                  alerts.length > 0
                    ? t('metrics.alertCount', { count: alerts.length })
                    : heroTone === 'warn'
                      ? t('metrics.attention')
                      : t('metrics.normal'),
                tone: heroTone,
              },
              items: [
                {
                  label: 'Load 1m',
                  value: load1 != null ? load1.toFixed(2) : '—',
                },
                {
                  label: t('common.memory'),
                  value: memPct != null ? `${memPct}%` : '—',
                  tone:
                    memPct != null && memPct >= 90
                      ? 'danger'
                      : memPct != null && memPct >= 75
                        ? 'warn'
                        : 'ok',
                },
                {
                  label: t('metrics.disk'),
                  value: diskPct != null ? `${diskPct}%` : '—',
                  tone:
                    diskPct != null && diskPct >= 90
                      ? 'danger'
                      : diskPct != null && diskPct >= 75
                        ? 'warn'
                        : 'ok',
                },
                {
                  label: t('metrics.alerts'),
                  value: alerts.length,
                  tone: alerts.length ? 'warn' : 'ok',
                },
                { label: 'CPU', value: cpuCount || '—' },
                { label: 'Uptime', value: formatUptime(uptimeSec) },
              ],
            }
          : undefined
      }
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            loading={loading && !follow}
            onClick={() => {
              void refresh();
              if (tab === 'live') void refreshProcesses();
              if (tab === 'projects' || tab === 'storage') void refreshProjectUsage();
            }}
          >
            {t('common.refresh')}
          </Button>
          {tab === 'overview' ? (
            <label className="met-toggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={bindCheck(setAutoRefresh)}
              />
              <span>{t('metrics.auto5s')}</span>
            </label>
          ) : null}
          <Link to="/system" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('metrics.hostSettings')}
          </Link>
          <Link to="/system/readiness" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('nav.readiness')}
          </Link>
        </>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading && !metrics ? <LoadingBlock label={t('metrics.loading')} /> : null}

      {metrics ? (
        <div className="met">
          <PageTabs
            tabs={[
              { id: 'overview', label: t('metrics.tabs.overview') },
              { id: 'live', label: t('metrics.tabs.live'), badge: follow ? 'LIVE' : undefined },
              {
                id: 'storage',
                label: t('metrics.disk'),
                badge: mounts.length || undefined,
              },
              {
                id: 'projects',
                label: t('metrics.tabs.projectUsage'),
                badge: projectUsage?.items?.length || undefined,
              },
              {
                id: 'alerts',
                label: t('metrics.alerts'),
                badge: alerts.length || undefined,
              },
            
          { id: 'about', label: t('common.about') },
        ]}
            active={tab}
            onChange={setTab}
            variant="scroll"
          >
            {tab === 'overview' ? (
              <div className="tab-panel">
                <div className="met-grid met-grid--3">
                  <section className="met-card">
                    <header className="met-card__head">
                      <h3 className="met-card__title">{t('metrics.load')}</h3>
                      <Badge
                        tone={
                          loadPressure != null && loadPressure > 2
                            ? 'danger'
                            : loadPressure != null && loadPressure > 1
                              ? 'warn'
                              : 'ok'
                        }
                      >
                        {loadPressure != null
                          ? `${loadPressure.toFixed(2)}×CPU`
                          : '—'}
                      </Badge>
                    </header>
                    <div className="met-meters">
                      {[
                        { lab: t('metrics.min1'), v: loadavg?.[0] },
                        { lab: t('metrics.min5'), v: loadavg?.[1] },
                        { lab: t('metrics.min15'), v: loadavg?.[2] },
                      ].map((row) => {
                        const pct =
                          row.v != null && cpuCount > 0
                            ? Math.min(100, (row.v / (cpuCount * 2)) * 100)
                            : 0;
                        return (
                          <div key={row.lab} className="met-meter">
                            <div className="met-meter__head">
                              <span>{row.lab}</span>
                              <strong>
                                {row.v != null ? row.v.toFixed(2) : '—'}
                              </strong>
                            </div>
                            <div className="met-meter__track">
                              <div
                                className="met-meter__fill u-meter-fill" style={{ ["--meter-pct" as string]: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="met-footnote">
                      {t('metrics.loadHint', { cpus: cpuCount || '?' })}
                    </p>
                  </section>

                  <section className="met-card">
                    <header className="met-card__head">
                      <h3 className="met-card__title">{t('common.memory')}</h3>
                      <Badge
                        tone={
                          memPct != null && memPct >= 90
                            ? 'danger'
                            : memPct != null && memPct >= 75
                              ? 'warn'
                              : 'ok'
                        }
                      >
                        {memPct != null ? `${memPct}%` : '—'}
                      </Badge>
                    </header>
                    <div className="met-meter met-meter--lg">
                      <div className="met-meter__track met-meter__track--lg">
                        <div
                          className={`met-meter__fill${
                            memPct != null && memPct >= 90
                              ? ' met-meter__fill--danger'
                              : memPct != null && memPct >= 75
                                ? ' met-meter__fill--warn'
                                : ''
                          } u-meter-fill`} style={{ ["--meter-pct" as string]: `${Math.min(100, memPct ?? 0)}%` }}
                        />
                      </div>
                    </div>
                    <dl className="met-dl">
                      <div>
                        <dt>{t('metrics.total')}</dt>
                        <dd>{formatBytes(mem?.total)}</dd>
                      </div>
                      <div>
                        <dt>{t('metrics.available')}</dt>
                        <dd>
                          {formatBytes(
                            mem?.available != null ? mem.available : mem?.free,
                          )}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className="met-card">
                    <header className="met-card__head">
                      <h3 className="met-card__title">{t('metrics.mainDisk')}</h3>
                      <Badge
                        tone={
                          diskPct != null && diskPct >= 90
                            ? 'danger'
                            : diskPct != null && diskPct >= 75
                              ? 'warn'
                              : 'ok'
                        }
                      >
                        {diskPct != null ? `${diskPct}%` : '—'}
                      </Badge>
                    </header>
                    {disk ? (
                      <>
                        <div className="met-meter met-meter--lg">
                          <div className="met-meter__track met-meter__track--lg">
                            <div
                              className={`met-meter__fill${
                                diskPct != null && diskPct >= 90
                                  ? ' met-meter__fill--danger'
                                  : diskPct != null && diskPct >= 75
                                    ? ' met-meter__fill--warn'
                                    : ''
                              }`}
                              style={{ ['--meter-pct' as string]: `${Math.min(100, diskPct ?? 0)}%` }}
                            />
                          </div>
                        </div>
                        <dl className="met-dl">
                          <div>
                            <dt>{t('metrics.path')}</dt>
                            <dd>
                              <code>{disk.path ?? '/'}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>{t('metrics.total')}</dt>
                            <dd>{formatBytes(disk.total)}</dd>
                          </div>
                          <div>
                            <dt>{t('metrics.available')}</dt>
                            <dd>{formatBytes(disk.free)}</dd>
                          </div>
                        </dl>
                      </>
                    ) : (
                      <p className="met-muted">{t('metrics.diskReadFail')}</p>
                    )}
                    {mounts.length > 1 ? (
                      <button
                        type="button"
                        className="met-linkish"
                        onClick={bindSet(setTab, 'storage')}
                      >
                        {t('metrics.viewAllMounts', { count: mounts.length })}
                      </button>
                    ) : null}
                  </section>
                </div>

                {alerts.length > 0 ? (
                  <div className="met-alert-strip">
                    <Badge tone="warn">{t('metrics.nAlerts', { count: alerts.length })}</Badge>
                    <span>{alerts.map((a) => alertLabel(a, t)).join(' · ')}</span>
                    <button
                      type="button"
                      className="met-linkish"
                      onClick={bindSet(setTab, 'alerts')}
                    >
                      {t('metrics.details')}
                    </button>
                  </div>
                ) : (
                  <div className="met-ok-strip">{t('metrics.noThresholdAlerts')}</div>
                )}

                {projectUsage && (projectUsage.items?.length ?? 0) > 0 ? (
                  <section className="met-card u-mt-4">
                    <header className="met-card__head">
                      <h3 className="met-card__title">{t('metrics.projectDisk')}</h3>
                      <Badge tone="ok">
                        {formatBytes(projectUsage.totalUsedBytes)}
                      </Badge>
                    </header>
                    <ul className="met-project-strip">
                      {(projectUsage.items ?? []).slice(0, 5).map((p) => {
                        const pct =
                          p.usedRatio != null
                            ? Math.round(p.usedRatio * 100)
                            : null;
                        return (
                          <li key={p.projectId} className="met-project-strip__row">
                            <Link
                              to={`/projects/${encodeURIComponent(p.projectId)}`}
                              className="met-linkish"
                            >
                              {p.name}
                            </Link>
                            <span className="muted u-text-sm">
                              {formatBytes(p.usedBytes)}
                              {p.quotaMb != null ? ` / ${p.quotaMb} MiB` : ''}
                            </span>
                            {pct != null ? (
                              <Badge
                                tone={
                                  pct >= 90
                                    ? 'danger'
                                    : pct >= 75
                                      ? 'warn'
                                      : 'ok'
                                }
                              >
                                {pct}%
                              </Badge>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      className="met-linkish"
                      onClick={bindSet(setTab, 'projects')}
                    >
                      {t('metrics.viewAllProjectUsage')}
                    </button>
                  </section>
                ) : (
                  <div className="met-ok-strip u-mt-3">
                    <button
                      type="button"
                      className="met-linkish"
                      onClick={() => {
                        setTab('projects');
                        void refreshProjectUsage();
                      }}
                    >
                      {t('metrics.loadProjectDisk')}
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {tab === 'live' ? (
              <div className="tab-panel">
                <div className="met-live-bar">
                  <label className={`met-toggle ${follow ? 'met-toggle--on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={follow}
                      onChange={bindCheck(setFollow)}
                    />
                    <span>{t('metrics.followSse')}</span>
                  </label>
                  <label className="met-field">
                    <span>{t('metrics.interval')}</span>
                    <select
                      value={intervalSec}
                      onChange={(e) => setIntervalSec(Number(e.target.value) || 2)}
                    >
                      <option value={1}>1s</option>
                      <option value={2}>2s</option>
                      <option value={3}>3s</option>
                      <option value={5}>5s</option>
                    </select>
                  </label>
                  <label className="met-field">
                    <span>{t('metrics.sort')}</span>
                    <select
                      value={sort}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSort(
                          v === 'mem' || v === 'time' || v === 'pid' ? v : 'cpu',
                        );
                      }}
                    >
                      <option value="cpu">%CPU</option>
                      <option value="mem">%MEM</option>
                      <option value="time">TIME+</option>
                      <option value="pid">PID</option>
                    </select>
                  </label>
                  <label className="met-field">
                    <span>{t('metrics.rows')}</span>
                    <select
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value) || 40)}
                    >
                      <option value={20}>20</option>
                      <option value={40}>40</option>
                      <option value={60}>60</option>
                      <option value={80}>80</option>
                    </select>
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={follow}
                    onClick={bindVoid(refreshProcesses)}
                  >
                    {t('metrics.onceQuery')}
                  </Button>
                  <label className="met-toggle">
                    <input
                      type="checkbox"
                      checked={showRawTop}
                      onChange={bindCheck(setShowRawTop)}
                    />
                    <span>raw top</span>
                  </label>
                  {processes?.at ? (
                    <span className="met-live-at muted u-text-sm">
                      {follow ? 'LIVE · ' : ''}
                      {new Date(processes.at).toLocaleTimeString()}
                    </span>
                  ) : null}
                </div>

                <TopHeaderPanel
                  header={processes?.topHeader}
                  perCpu={perCpu}
                  onTogglePerCpu={setPerCpu}
                />

                <div className="met-live-bar met-live-bar--ops">
                  <label className="met-search" htmlFor="metrics-proc-search">
                    <input
                      id="metrics-proc-search"
                      name="metrics-proc-search"
                      type="search"
                      placeholder={t('metrics.procSearchPh')}
                      value={search}
                      onChange={bindInput(setSearch)}
                      aria-label={t('metrics.procSearchAria')}
                      autoComplete="off"
                    />
                  </label>
                  <div className="met-chips">
                    {(
                      [
                        ['none', t('metrics.filterAll')],
                        ['mine', t('metrics.filterMine')],
                        ['cpu5', '≥5%CPU'],
                        ['mem5', '≥5%MEM'],
                      ] as const
                    ).map(([id, lab]) => (
                      <button
                        key={id}
                        type="button"
                        className={`met-chip${quick === id ? ' is-on' : ''}`}
                        onClick={bindSet(setQuick, id)}
                      >
                        {lab}
                      </button>
                    ))}
                  </div>
                  <span className="met-sel-count muted u-text-sm">
                    {t('metrics.selectedN', { count: selected.size })}
                    {filteredRows.length !== rows.length
                      ? t('metrics.showOf', { shown: filteredRows.length, total: rows.length })
                      : ''}
                  </span>
                  <div className="met-signal-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!primarySelected || signalBusy}
                      onClick={() =>
                        primarySelected && openSignal(primarySelected.pid, 'TERM')
                      }
                    >
                      TERM
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={!primarySelected || signalBusy}
                      onClick={() =>
                        primarySelected && openSignal(primarySelected.pid, 'KILL')
                      }
                    >
                      KILL
                    </Button>
                  </div>
                </div>

                {streamErr ? <Alert variant="error">{streamErr}</Alert> : null}

                {lastSignal ? (
                  <div className="met-signal-result">
                    <OpsResultPanel
                      title={t('metrics.signalTo', { sig: lastSignal.signal, pid: lastSignal.pid })}
                      result={{
                        ok: lastSignal.ok,
                        blocked: lastSignal.blocked,
                        blockMessage: lastSignal.blockMessage,
                        notes: [
                          ...(lastSignal.stillAlive != null
                            ? [
                                lastSignal.stillAlive
                                  ? t('metrics.procAlive')
                                  : t('metrics.procGone'),
                              ]
                            : []),
                          ...(lastSignal.notes ?? []),
                        ],
                      }}
                    />
                  </div>
                ) : null}

                <DataTable<ProcessRow>
                  className="data-table--live"
                  title={t('metrics.procTable', {
                    count: filteredRows.length,
                    more:
                      filteredRows.length !== rows.length
                        ? `/${rows.length}`
                        : '',
                  })}
                  description={t('metrics.procTableDesc')}
                  columns={[
                    {
                      key: 'sel',
                      header: (
                        <input
                          type="checkbox"
                          checked={
                            filteredRows.length > 0 &&
                            filteredRows.every((r) => selected.has(r.pid))
                          }
                          onChange={selectAllFiltered}
                          aria-label={t('metrics.selectAllAria')}
                        />
                      ),
                      className: 'data-table__check',
                      nowrap: true,
                      render: (r) => (
                        <input
                          type="checkbox"
                          checked={selected.has(r.pid)}
                          onChange={() => toggleSelect(r.pid)}
                          aria-label={t('metrics.selectPidAria', { pid: r.pid })}
                        />
                      ),
                    },
                    {
                      key: 'pid',
                      header: 'PID',
                      nowrap: true,
                      render: (r) => (
                        <button
                          type="button"
                          className="met-pid-link"
                          onClick={bindCall1(openDetail, r.pid)}
                        >
                          <code>{r.pid}</code>
                        </button>
                      ),
                    },
                    {
                      key: 'user',
                      header: 'USER',
                      nowrap: true,
                      render: (r) => r.user,
                    },
                    {
                      key: 'pr',
                      header: 'PR',
                      className: 'u-num muted',
                      nowrap: true,
                      render: (r) => r.pr ?? '—',
                    },
                    {
                      key: 'ni',
                      header: 'NI',
                      className: 'u-num muted',
                      nowrap: true,
                      render: (r) => (r.ni != null ? r.ni : '—'),
                    },
                    {
                      key: 'res',
                      header: 'RES',
                      className: 'u-num',
                      nowrap: true,
                      render: (r) => formatRes(r.resKiB),
                    },
                    {
                      key: 'state',
                      header: 'S',
                      nowrap: true,
                      render: (r) => (
                        <code className="met-state">{r.state?.[0] ?? '—'}</code>
                      ),
                    },
                    {
                      key: 'cpu',
                      header: '%CPU',
                      className: 'u-num',
                      nowrap: true,
                      render: (r) => (
                        <span className={r.cpu >= 20 ? 'met-hot' : undefined}>
                          {r.cpu.toFixed(1)}
                        </span>
                      ),
                    },
                    {
                      key: 'mem',
                      header: '%MEM',
                      className: 'u-num',
                      nowrap: true,
                      render: (r) => r.mem.toFixed(1),
                    },
                    {
                      key: 'time',
                      header: 'TIME+',
                      className: 'data-table__etime',
                      nowrap: true,
                      render: (r) => r.timePlus ?? r.etime ?? '—',
                    },
                    {
                      key: 'cmd',
                      header: 'COMMAND',
                      className: 'data-table__cmd',
                      render: (r) => (
                        <span title={r.command}>
                          {r.command}
                          {isControlPlaneRow(r) ? (
                            <Badge tone="warn">{t('metrics.controlPlane')}</Badge>
                          ) : null}
                        </span>
                      ),
                    },
                  ]}
                  rows={filteredRows}
                  rowKey={(r) => `${r.pid}-${r.command.slice(0, 24)}`}
                  rowClassName={(r) =>
                    selected.has(r.pid)
                      ? 'is-selected'
                      : isControlPlaneRow(r)
                        ? 'is-control-plane'
                        : undefined
                  }
                  rowActions={(r) => {
                    const cp = isControlPlaneRow(r);
                    return (
                      <div className="met-row-actions">
                        <button
                          type="button"
                          className="met-icon-btn"
                          title={t('metrics.details')}
                          onClick={bindCall1(openDetail, r.pid)}
                        >
                          {t('metrics.detailShort')}
                        </button>
                        <button
                          type="button"
                          className="met-icon-btn"
                          title="SIGTERM"
                          disabled={cp}
                          onClick={bindCall2(openSignal, r.pid, 'TERM')}
                        >
                          T
                        </button>
                        <button
                          type="button"
                          className="met-icon-btn met-icon-btn--danger"
                          title="SIGKILL"
                          disabled={cp}
                          onClick={bindCall2(openSignal, r.pid, 'KILL')}
                        >
                          K
                        </button>
                      </div>
                    );
                  }}
                  empty={
                    <EmptyState
                      title={
                        rows.length === 0
                          ? processes && !processes.ok
                            ? processes.notes?.[0] || t('metrics.procUnavailable')
                            : t('metrics.noProcData')
                          : t('metrics.noProcFilter')
                      }
                      description={
                        rows.length === 0 && !(processes && !processes.ok)
                          ? t('metrics.clickOnceOrFollow')
                          : processes && !processes.ok
                            ? processes.notes?.slice(1).join(' · ') || undefined
                            : undefined
                      }
                    />
                  }
                />

                {showRawTop && processes?.rawTop ? (
                  <pre className="met-raw-top">{processes.rawTop}</pre>
                ) : null}
                {processes?.notes?.length ? (
                  <p className="met-footnote">{processes.notes.join(' · ')}</p>
                ) : (
                  <p className="met-footnote">
                    {t('metrics.liveFootnote')}
                  </p>
                )}

                <ConfirmDialog
                  open={pending != null}
                  onClose={() => !signalBusy && setPending(null)}
                  onConfirm={bindVoid(runSignal)}
                  title={
                    pending?.signal === 'KILL'
                      ? t('metrics.forceKillTitle', { pid: pending?.pid })
                      : t('metrics.sendSigTitle', { pid: pending?.pid, sig: pending?.signal ?? 'TERM' })
                  }
                  description={
                    pending?.signal === 'KILL'
                      ? t('metrics.forceKillDesc', { cmd: (pending?.command ?? '—').slice(0, 120) })
                      : t('metrics.termDesc', { cmd: (pending?.command ?? '—').slice(0, 120) })
                  }
                  confirmLabel={
                    pending?.signal === 'KILL' ? t('metrics.forceKillBtn') : t('metrics.sendTermBtn')
                  }
                  cancelLabel={t('common.cancel')}
                  danger={pending?.signal === 'KILL'}
                  busy={signalBusy}
                />

                <Modal
                  open={detailPid != null}
                  onClose={() => {
                    setDetailPid(null);
                    setDetail(null);
                  }}
                  title={detailPid ? t('metrics.procPidTitle', { pid: detailPid }) : t('metrics.procDetail')}
                  size="md"
                  footer={
                    <ActionBar size="sm" align="end">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setDetailPid(null);
                          setDetail(null);
                        }}
                      >
                        {t('common.close')}
                      </Button>
                      {detailPid ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={bindCall2(openSignal, detailPid, 'TERM')}
                          >
                            TERM
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={bindCall2(openSignal, detailPid, 'KILL')}
                          >
                            KILL
                          </Button>
                        </>
                      ) : null}
                    </ActionBar>
                  }
                >
                  {detailLoading ? (
                    <LoadingBlock label={t('metrics.readingProc')} />
                  ) : detail ? (
                    <div className="stack">
                      <dl className="met-detail-dl">
                        <div>
                          <dt>cmdline</dt>
                          <dd>
                            <code>{detail.command ?? '—'}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>cwd</dt>
                          <dd>
                            <code>{detail.cwd ?? '—'}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>open fds</dt>
                          <dd>
                            {detail.fdCount != null ? detail.fdCount : '—'}
                          </dd>
                        </div>
                        {detail.notes?.length ? (
                          <div>
                            <dt>notes</dt>
                            <dd>{detail.notes.join(' · ')}</dd>
                          </div>
                        ) : null}
                      </dl>
                      {detailPid ? (
                        <div className="met-renice">
                          <label className="toolbar-field" htmlFor="met-nice">
                            <span>nice</span>
                            <input
                              id="met-nice"
                              type="number"
                              min={-20}
                              max={19}
                              value={niceVal}
                              onChange={bindInput(setNiceVal)}
                            />
                          </label>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={signalBusy}
                            onClick={() => {
                              void (async () => {
                                setSignalBusy(true);
                                try {
                                  const r = await metricsApi.renice({
                                    pid: detailPid,
                                    nice: Number(niceVal),
                                  });
                                  setLastSignal({
                                    ok: r.ok,
                                    blocked: r.blocked,
                                    blockMessage: r.blockMessage,
                                    pid: r.pid,
                                    signal: 'TERM',
                                    notes: r.notes,
                                  });
                                } finally {
                                  setSignalBusy(false);
                                }
                              })();
                            }}
                          >
                            {t('metrics.applyRenice')}
                          </Button>
                          <span className="muted u-text-sm">
                            {t('metrics.reniceHint')}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="met-muted">{t('metrics.noData')}</p>
                  )}
                </Modal>
              </div>
            ) : null}

            {tab === 'storage' ? (
              <div className="tab-panel">
                <DataTable
                  title={t('metrics.mountsTitle', { count: mounts.length })}
                  description={t('metrics.mountsDesc')}
                  className="data-table--live"
                  columns={[
                    {
                      key: 'fs',
                      header: 'Filesystem',
                      render: (m) => (
                        <code className="inline">{m.filesystem}</code>
                      ),
                    },
                    {
                      key: 'mount',
                      header: 'Mount',
                      render: (m) => <code className="inline">{m.mount}</code>,
                    },
                    {
                      key: 'size',
                      header: 'Size',
                      className: 'u-num',
                      nowrap: true,
                      render: (m) => formatBytes(m.size),
                    },
                    {
                      key: 'used',
                      header: 'Used',
                      className: 'u-num',
                      nowrap: true,
                      render: (m) => formatBytes(m.used),
                    },
                    {
                      key: 'avail',
                      header: 'Avail',
                      className: 'u-num',
                      nowrap: true,
                      render: (m) => formatBytes(m.avail),
                    },
                    {
                      key: 'pct',
                      header: 'Use%',
                      nowrap: true,
                      render: (m) => {
                        const pct = Math.round(m.usedRatio * 100);
                        return (
                          <Badge
                            tone={
                              pct >= 90
                                ? 'danger'
                                : pct >= 75
                                  ? 'warn'
                                  : 'ok'
                            }
                          >
                            {pct}%
                          </Badge>
                        );
                      },
                    },
                    {
                      key: 'bar',
                      header: '',
                      render: (m) => {
                        const pct = Math.round(m.usedRatio * 100);
                        return (
                          <div className="met-meter__track met-meter__track--sm">
                            <div
                              className={`met-meter__fill${
                                pct >= 90
                                  ? ' met-meter__fill--danger'
                                  : pct >= 75
                                    ? ' met-meter__fill--warn'
                                    : ''
                              } u-meter-fill`} style={{ ["--meter-pct" as string]: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                        );
                      },
                    },
                  ]}
                  rows={mounts}
                  rowKey={(m) => `${m.filesystem}:${m.mount}`}
                  empty={
                    <EmptyState
                      title={t('metrics.noMounts')}
                      description={t('metrics.noMountsDesc')}
                    />
                  }
                />
                {projectUsage?.items.length ? (
                  <p className="met-footnote u-mt-3">
                    {t('metrics.seeProjectUsage', {
                      size: formatBytes(projectUsage.totalUsedBytes),
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {tab === 'projects' ? (
              <div className="tab-panel">
                {projectUsageErr ? (
                  <Alert variant="error">{projectUsageErr}</Alert>
                ) : null}
                {projectUsageLoading && !projectUsage ? (
                  <LoadingBlock label={t('metrics.measuringDu')} />
                ) : (
                  <DataTable<ProjectDiskUsageRow>
                    title={t('metrics.projectUsageTitle', { count: projectUsage?.items.length ?? 0 })}
                    description={
                      projectUsage
                        ? t('metrics.projectUsageDesc', { total: formatBytes(projectUsage.totalUsedBytes), at: new Date(projectUsage.at).toLocaleString() })
                        : t('metrics.projectUsageDescEmpty')
                    }
                    toolbar={
                      <ActionBar>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={projectUsageLoading}
                          onClick={bindVoid(refreshProjectUsage)}
                        >
                          {t('metrics.remeasure')}
                        </Button>
                      </ActionBar>
                    }
                    columns={[
                      {
                        key: 'name',
                        header: t('metrics.project'),
                        render: (r) => (
                          <Link
                            to={`/projects/${encodeURIComponent(r.projectId)}`}
                            className={buttonClassName({ variant: 'link', size: 'md' })}
                          >
                            <strong>{r.name}</strong>
                            {r.domain ? (
                              <span className="muted u-text-sm"> · {r.domain}</span>
                            ) : null}
                          </Link>
                        ),
                      },
                      {
                        key: 'home',
                        header: 'Home',
                        render: (r) => (
                          <code className="inline u-break-all">
                            {r.homeDir || '—'}
                          </code>
                        ),
                      },
                      {
                        key: 'used',
                        header: t('metrics.used'),
                        render: (r) => formatBytes(r.usedBytes),
                      },
                      {
                        key: 'quota',
                        header: t('metrics.quota'),
                        render: (r) =>
                          r.quotaMb != null ? `${r.quotaMb} MiB` : t('metrics.unlimited'),
                      },
                      {
                        key: 'ratio',
                        header: t('metrics.ratio'),
                        render: (r) => {
                          if (r.usedRatio == null) {
                            return <span className="muted">—</span>;
                          }
                          const pct = Math.round(r.usedRatio * 100);
                          return (
                            <Badge
                              tone={
                                r.withinQuota === false
                                  ? 'danger'
                                  : pct >= 75
                                    ? 'warn'
                                    : 'ok'
                              }
                            >
                              {pct}%
                            </Badge>
                          );
                        },
                      },
                    ]}
                    rows={projectUsage?.items ?? []}
                    rowKey={(r) => r.projectId}
                    empty={
                      <EmptyState
                        title={t('metrics.noProjects')}
                        description={t('metrics.noProjectsDesc')}
                      />
                    }
                  />
                )}
                {projectUsage?.notes?.length ? (
                  <p className="met-footnote">{projectUsage.notes.join(' · ')}</p>
                ) : (
                  <p className="met-footnote">{t('metrics.usageNoteFull')}</p>
                )}
              </div>
            ) : null}

            {tab === 'alerts' ? (
              <div className="tab-panel stack">
                <section className="met-card">
                  <header className="met-card__head">
                    <h3 className="met-card__title">{t('metrics.thresholdAlerts')}</h3>
                    <Badge tone={alerts.length ? 'warn' : 'ok'}>
                      {alerts.length}
                    </Badge>
                  </header>
                  {alerts.length === 0 ? (
                    <div className="met-empty met-empty--ok">
                      <strong>{t('metrics.alertsOkTitle')}</strong>
                      <p>{t('metrics.alertsOkDesc')}</p>
                    </div>
                  ) : (
                    <ul className="met-alert-list">
                      {alerts.map((a) => (
                        <li key={a}>
                          <Badge tone="warn">{alertLabel(a, t)}</Badge>
                          <code>{a}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            ) : null}
          
        {tab === 'about' ? <PageGuide guideId="metrics" /> : null}
      </PageTabs>
        </div>
      ) : null}
    </FeaturePageLayout>
  );
}
