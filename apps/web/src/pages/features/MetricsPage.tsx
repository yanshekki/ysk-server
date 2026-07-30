/**
 * Host metrics — tabbed ops console with live process table (batch top/ps stream).
 * Live tab: full top(1) header (per-cpu "1"), filter, select, TERM/KILL.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
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
import {
  TopHeaderPanel,
  formatRes,
} from '../../features/metrics/TopHeaderPanel';

const MET_TABS = ['overview', 'live', 'storage', 'projects', 'alerts'] as const;

type QuickFilter = 'none' | 'mine' | 'cpu5' | 'mem5';

type PendingSignal = {
  pid: string;
  signal: ProcessSignal;
  command: string;
};

function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatUptime(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function alertLabel(a: string): string {
  const map: Record<string, string> = {
    memory_high: '記憶體偏高',
    load_high: '負載偏高',
    disk_high: '磁碟偏高',
  };
  return map[a] ?? a;
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
      setError(e instanceof Error ? e.message : '載入指標失敗');
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
      setProjectUsageErr(e instanceof Error ? e.message : '專案用量載入失敗');
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
      setStreamErr(p.ok ? null : p.notes?.[0] ?? '進程列表失敗');
    } catch (e) {
      setStreamErr(e instanceof Error ? e.message : '進程列表失敗');
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
            setStreamErr((e) => e ?? `stream 已結束（${reason}）`);
          }
        },
      });
    } catch (e) {
      setFollow(false);
      setStreamErr(e instanceof Error ? e.message : '無法開啟 stream');
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
        notes: [e instanceof Error ? e.message : '訊號失敗'],
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
        notes: [e instanceof Error ? e.message : '無法載入詳情'],
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
      title={t('nav.metrics', { defaultValue: '主機指標' })}
      showCapability={false}
      status={
        metrics
          ? {
              pill: {
                label:
                  alerts.length > 0
                    ? `${alerts.length} 則告警`
                    : heroTone === 'warn'
                      ? '需留意'
                      : '正常',
                tone: heroTone,
              },
              items: [
                {
                  label: 'Load 1m',
                  value: load1 != null ? load1.toFixed(2) : '—',
                },
                {
                  label: '記憶體',
                  value: memPct != null ? `${memPct}%` : '—',
                  tone:
                    memPct != null && memPct >= 90
                      ? 'danger'
                      : memPct != null && memPct >= 75
                        ? 'warn'
                        : 'ok',
                },
                {
                  label: '磁碟',
                  value: diskPct != null ? `${diskPct}%` : '—',
                  tone:
                    diskPct != null && diskPct >= 90
                      ? 'danger'
                      : diskPct != null && diskPct >= 75
                        ? 'warn'
                        : 'ok',
                },
                {
                  label: '告警',
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
            重新整理
          </Button>
          {tab === 'overview' ? (
            <label className="met-toggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              <span>自動 5s</span>
            </label>
          ) : null}
          <Link to="/system" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            主機設定
          </Link>
          <Link to="/system/readiness" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            就緒探測
          </Link>
        </>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading && !metrics ? <LoadingBlock label="載入指標…" /> : null}

      {metrics ? (
        <div className="met">
          <PageTabs
            tabs={[
              { id: 'overview', label: '概覽' },
              { id: 'live', label: '即時進程', badge: follow ? 'LIVE' : undefined },
              {
                id: 'storage',
                label: '磁碟',
                badge: mounts.length || undefined,
              },
              {
                id: 'projects',
                label: '專案用量',
                badge: projectUsage?.items.length || undefined,
              },
              {
                id: 'alerts',
                label: '告警',
                badge: alerts.length || undefined,
              },
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
                      <h3 className="met-card__title">負載</h3>
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
                        { lab: '1 分', v: loadavg?.[0] },
                        { lab: '5 分', v: loadavg?.[1] },
                        { lab: '15 分', v: loadavg?.[2] },
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
                                className="met-meter__fill"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="met-footnote">
                      相對 {cpuCount || '?'} CPU；高於 1.0× 表示可能排隊。
                    </p>
                  </section>

                  <section className="met-card">
                    <header className="met-card__head">
                      <h3 className="met-card__title">記憶體</h3>
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
                          }`}
                          style={{ width: `${Math.min(100, memPct ?? 0)}%` }}
                        />
                      </div>
                    </div>
                    <dl className="met-dl">
                      <div>
                        <dt>總量</dt>
                        <dd>{formatBytes(mem?.total)}</dd>
                      </div>
                      <div>
                        <dt>可用</dt>
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
                      <h3 className="met-card__title">主磁碟</h3>
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
                              style={{
                                width: `${Math.min(100, diskPct ?? 0)}%`,
                              }}
                            />
                          </div>
                        </div>
                        <dl className="met-dl">
                          <div>
                            <dt>路徑</dt>
                            <dd>
                              <code>{disk.path ?? '/'}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>總量</dt>
                            <dd>{formatBytes(disk.total)}</dd>
                          </div>
                          <div>
                            <dt>可用</dt>
                            <dd>{formatBytes(disk.free)}</dd>
                          </div>
                        </dl>
                      </>
                    ) : (
                      <p className="met-muted">無法讀取磁碟</p>
                    )}
                    {mounts.length > 1 ? (
                      <button
                        type="button"
                        className="met-linkish"
                        onClick={() => setTab('storage')}
                      >
                        查看全部 {mounts.length} 個 mount →
                      </button>
                    ) : null}
                  </section>
                </div>

                {alerts.length > 0 ? (
                  <div className="met-alert-strip">
                    <Badge tone="warn">{alerts.length} 告警</Badge>
                    <span>{alerts.map(alertLabel).join(' · ')}</span>
                    <button
                      type="button"
                      className="met-linkish"
                      onClick={() => setTab('alerts')}
                    >
                      詳情
                    </button>
                  </div>
                ) : (
                  <div className="met-ok-strip">目前無記憶體／負載／磁碟閾值告警</div>
                )}

                {projectUsage && projectUsage.items.length > 0 ? (
                  <section className="met-card u-mt-4">
                    <header className="met-card__head">
                      <h3 className="met-card__title">專案磁碟（真實 du）</h3>
                      <Badge tone="ok">
                        {formatBytes(projectUsage.totalUsedBytes)}
                      </Badge>
                    </header>
                    <ul className="met-project-strip">
                      {projectUsage.items.slice(0, 5).map((p) => {
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
                      onClick={() => setTab('projects')}
                    >
                      查看全部專案用量 →
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
                      載入專案磁碟用量（真實 du）→
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
                      onChange={(e) => setFollow(e.target.checked)}
                    />
                    <span>跟隨（SSE）</span>
                  </label>
                  <label className="met-field">
                    <span>間隔</span>
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
                    <span>排序</span>
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
                    <span>行數</span>
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
                    onClick={() => void refreshProcesses()}
                  >
                    單次查詢
                  </Button>
                  <label className="met-toggle">
                    <input
                      type="checkbox"
                      checked={showRawTop}
                      onChange={(e) => setShowRawTop(e.target.checked)}
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
                  <label className="met-search">
                    <input
                      type="search"
                      placeholder="搜尋 PID / USER / COMMAND"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label="搜尋進程"
                    />
                  </label>
                  <div className="met-chips">
                    {(
                      [
                        ['none', '全部'],
                        ['mine', '非系統'],
                        ['cpu5', '≥5%CPU'],
                        ['mem5', '≥5%MEM'],
                      ] as const
                    ).map(([id, lab]) => (
                      <button
                        key={id}
                        type="button"
                        className={`met-chip${quick === id ? ' is-on' : ''}`}
                        onClick={() => setQuick(id)}
                      >
                        {lab}
                      </button>
                    ))}
                  </div>
                  <span className="met-sel-count muted u-text-sm">
                    選中 {selected.size}
                    {filteredRows.length !== rows.length
                      ? ` · 顯示 ${filteredRows.length}/${rows.length}`
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
                      title={`訊號 ${lastSignal.signal} → PID ${lastSignal.pid}`}
                      result={{
                        ok: lastSignal.ok,
                        blocked: lastSignal.blocked,
                        blockMessage: lastSignal.blockMessage,
                        notes: [
                          ...(lastSignal.stillAlive != null
                            ? [
                                lastSignal.stillAlive
                                  ? '進程仍在（kill -0 成功）'
                                  : '進程已結束',
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
                  title={`進程 (${filteredRows.length}${
                    filteredRows.length !== rows.length
                      ? `/${rows.length}`
                      : ''
                  })`}
                  description="ps 列表 · 勾選後可 TERM/KILL（需 YSK_EXECUTE）"
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
                          aria-label="全選篩選結果"
                        />
                      ),
                      className: 'data-table__check',
                      nowrap: true,
                      render: (r) => (
                        <input
                          type="checkbox"
                          checked={selected.has(r.pid)}
                          onChange={() => toggleSelect(r.pid)}
                          aria-label={`選取 PID ${r.pid}`}
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
                          onClick={() => void openDetail(r.pid)}
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
                            <Badge tone="warn">控制面</Badge>
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
                          title="詳情"
                          onClick={() => void openDetail(r.pid)}
                        >
                          詳
                        </button>
                        <button
                          type="button"
                          className="met-icon-btn"
                          title="SIGTERM"
                          disabled={cp}
                          onClick={() => openSignal(r.pid, 'TERM')}
                        >
                          T
                        </button>
                        <button
                          type="button"
                          className="met-icon-btn met-icon-btn--danger"
                          title="SIGKILL"
                          disabled={cp}
                          onClick={() => openSignal(r.pid, 'KILL')}
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
                            ? processes.notes?.[0] || '無法取得進程'
                            : '尚無進程資料'
                          : '無符合篩選的進程'
                      }
                      description={
                        rows.length === 0 && !(processes && !processes.ok)
                          ? '按「單次查詢」或開跟隨'
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
                    等同 SSH top：/proc/stat 雙樣本算 %Cpu（開「每核」= top 按 1）、Mem/Swap、Tasks；進程表來自
                    ps。唔係互動 PTY。Kill 需 YSK_EXECUTE；PID 1 與控制面預設保護。
                  </p>
                )}

                <ConfirmDialog
                  open={pending != null}
                  onClose={() => !signalBusy && setPending(null)}
                  onConfirm={() => void runSignal()}
                  title={
                    pending?.signal === 'KILL'
                      ? `強制結束 PID ${pending?.pid}（SIGKILL）`
                      : `向 PID ${pending?.pid} 發送 SIG${pending?.signal ?? 'TERM'}`
                  }
                  description={
                    pending?.signal === 'KILL'
                      ? `無法攔截，可能丟數據。指令：${(pending?.command ?? '—').slice(0, 120)}`
                      : `進程可自行清理後退出。指令：${(pending?.command ?? '—').slice(0, 120)}`
                  }
                  confirmLabel={
                    pending?.signal === 'KILL' ? '強制 KILL' : '發送 TERM'
                  }
                  cancelLabel="取消"
                  danger={pending?.signal === 'KILL'}
                  busy={signalBusy}
                />

                <Modal
                  open={detailPid != null}
                  onClose={() => {
                    setDetailPid(null);
                    setDetail(null);
                  }}
                  title={detailPid ? `進程 PID ${detailPid}` : '進程詳情'}
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
                        關閉
                      </Button>
                      {detailPid ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => openSignal(detailPid, 'TERM')}
                          >
                            TERM
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => openSignal(detailPid, 'KILL')}
                          >
                            KILL
                          </Button>
                        </>
                      ) : null}
                    </ActionBar>
                  }
                >
                  {detailLoading ? (
                    <LoadingBlock label="讀取 /proc…" />
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
                              onChange={(e) => setNiceVal(e.target.value)}
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
                            套用 renice
                          </Button>
                          <span className="muted u-text-sm">
                            -20 最高優先 · 19 最低（需 EXECUTE）
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="met-muted">無資料</p>
                  )}
                </Modal>
              </div>
            ) : null}

            {tab === 'storage' ? (
              <div className="tab-panel">
                <DataTable
                  title={`磁碟 mounts (${mounts.length})`}
                  description="真實 df -P -B1（已過濾 tmpfs 等）"
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
                              }`}
                              style={{ width: `${Math.min(100, pct)}%` }}
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
                      title="無 mount 列表"
                      description="df 不可用或被過濾。主磁碟仍見於概覽。"
                    />
                  }
                />
                {projectUsage?.items.length ? (
                  <p className="met-footnote u-mt-3">
                    專案 home 用量見「專案用量」分頁（真實 du · 共{' '}
                    {formatBytes(projectUsage.totalUsedBytes)}）
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
                  <LoadingBlock label="量測專案 home（du）…" />
                ) : (
                  <DataTable<ProjectDiskUsageRow>
                    title={`專案磁碟用量 (${projectUsage?.items.length ?? 0})`}
                    description={
                      projectUsage
                        ? `真實 du · 合計 ${formatBytes(projectUsage.totalUsedBytes)} · ${new Date(projectUsage.at).toLocaleString()}`
                        : '對各專案 home_dir 執行 du'
                    }
                    toolbar={
                      <ActionBar>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={projectUsageLoading}
                          onClick={() => void refreshProjectUsage()}
                        >
                          重新量測
                        </Button>
                      </ActionBar>
                    }
                    columns={[
                      {
                        key: 'name',
                        header: '專案',
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
                        header: '已用',
                        render: (r) => formatBytes(r.usedBytes),
                      },
                      {
                        key: 'quota',
                        header: '配額',
                        render: (r) =>
                          r.quotaMb != null ? `${r.quotaMb} MiB` : '無限制',
                      },
                      {
                        key: 'ratio',
                        header: '佔比',
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
                        title="尚無專案"
                        description="建立專案後可在此看真實 home 用量"
                      />
                    }
                  />
                )}
                {projectUsage?.notes?.length ? (
                  <p className="met-footnote">{projectUsage.notes.join(' · ')}</p>
                ) : (
                  <p className="met-footnote">
                    用量來自本機 du（非估算）。配額為控制面 soft limit；硬 setquota 需「套用限制到
                    OS」。
                  </p>
                )}
              </div>
            ) : null}

            {tab === 'alerts' ? (
              <div className="tab-panel stack">
                <section className="met-card">
                  <header className="met-card__head">
                    <h3 className="met-card__title">閾值告警</h3>
                    <Badge tone={alerts.length ? 'warn' : 'ok'}>
                      {alerts.length}
                    </Badge>
                  </header>
                  {alerts.length === 0 ? (
                    <div className="met-empty met-empty--ok">
                      <strong>目前正常</strong>
                      <p>沒有記憶體／負載／磁碟閾值告警。</p>
                    </div>
                  ) : (
                    <ul className="met-alert-list">
                      {alerts.map((a) => (
                        <li key={a}>
                          <Badge tone="warn">{alertLabel(a)}</Badge>
                          <code>{a}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            ) : null}
          </PageTabs>
        </div>
      ) : null}
    </FeaturePageLayout>
  );
}
