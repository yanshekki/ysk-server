/**
 * Host metrics — professional ops console.
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
} from '../../shared/components/ui';
import { api } from '../../shared/services/api';

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
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const m = await api.requestRaw<Record<string, unknown>>('/api/v1/metrics');
      setMetrics(m);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入指標失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadavg = Array.isArray(metrics?.loadavg)
    ? (metrics!.loadavg as number[])
    : null;
  const mem =
    metrics?.memory && typeof metrics.memory === 'object'
      ? (metrics.memory as { usedRatio?: number; total?: number; free?: number })
      : null;
  const disk =
    metrics?.disk && typeof metrics.disk === 'object'
      ? (metrics.disk as {
          path?: string;
          free?: number;
          total?: number;
          usedRatio?: number;
        })
      : null;
  const alerts = Array.isArray(metrics?.alerts)
    ? (metrics!.alerts as string[])
    : [];
  const memPct = mem?.usedRatio != null ? Math.round(mem.usedRatio * 100) : null;
  const diskPct =
    disk?.usedRatio != null ? Math.round(disk.usedRatio * 100) : null;
  const cpuCount = Number(metrics?.cpuCount) || 0;
  const uptimeSec =
    typeof metrics?.uptimeSec === 'number' ? metrics.uptimeSec : undefined;

  const load1 = loadavg?.[0];
  const loadPressure =
    load1 != null && cpuCount > 0 ? load1 / cpuCount : null;

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

  const facts = useMemo(() => {
    const out: Array<{ label: string; value: string }> = [];
    if (!metrics) return out;
    for (const [k, v] of Object.entries(metrics)) {
      if (k === 'loadavg' || k === 'memory' || k === 'alerts' || k === 'disk')
        continue;
      if (v == null || typeof v === 'object') continue;
      if (k === 'uptimeSec') {
        out.push({ label: 'uptime', value: formatUptime(Number(v)) });
        continue;
      }
      out.push({ label: k, value: String(v) });
    }
    return out;
  }, [metrics]);

  return (
    <FeaturePageLayout
      title={t('nav.metrics', { defaultValue: '主機指標' })}
      showCapability={false}
      actions={
        <>
          <Button
            variant="secondary"
            size="md"
            loading={loading}
            onClick={() => void refresh()}
          >
            重新整理
          </Button>
          <Link to="/system" className="btn btn--ghost btn--md">
            主機設定
          </Link>
          <Link to="/system/readiness" className="btn btn--ghost btn--md">
            就緒探測
          </Link>
        </>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading && !metrics ? <LoadingBlock label="載入指標…" /> : null}

      {metrics ? (
        <div className="ops">
          <section className={`ops-hero ops-hero--${heroTone}`} aria-label="指標總覽">
            <div className="ops-hero__main">
              <div className="ops-hero__copy">
                <div className="ops-hero__eyebrow">Host metrics</div>
                <h2 className="ops-hero__title">
                  <span className={`ops-hero__pill ops-hero__pill--${heroTone}`}>
                    {alerts.length > 0
                      ? `${alerts.length} 則告警`
                      : heroTone === 'warn'
                        ? '需留意'
                        : '正常'}
                  </span>
                  即時資源快照
                </h2>
                <p className="ops-hero__hint">
                  即時快照；告警不改系統。
                </p>
                <div className="ops-hero__meta">
                  <span>
                    CPU ×<strong>{cpuCount || '—'}</strong>
                  </span>
                  <span className="ops-hero__dot" />
                  <span>
                    Uptime <strong>{formatUptime(uptimeSec)}</strong>
                  </span>
                  <span className="ops-hero__dot" />
                  <span>
                    採樣{' '}
                    <strong>
                      {metrics.at
                        ? new Date(String(metrics.at)).toLocaleString('zh-TW')
                        : '—'}
                    </strong>
                  </span>
                </div>
                <div className="ops-hero__cta">
                  <Button
                    variant="primary"
                    size="md"
                    loading={loading}
                    onClick={() => void refresh()}
                  >
                    重新採樣
                  </Button>
                  <Link to="/services" className="btn btn--secondary btn--md">
                    服務狀態
                  </Link>
                  <Link to="/logs" className="btn btn--ghost btn--md">
                    日誌中心
                  </Link>
                </div>
              </div>
              <div className="ops-hero__stats">
                <div className="ops-stat">
                  <span className="ops-stat__lab">Load 1m</span>
                  <span className="ops-stat__val">
                    {load1 != null ? load1.toFixed(2) : '—'}
                  </span>
                </div>
                <div className="ops-stat">
                  <span className="ops-stat__lab">記憶體</span>
                  <span className="ops-stat__val">
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
                  </span>
                </div>
                <div className="ops-stat">
                  <span className="ops-stat__lab">磁碟</span>
                  <span className="ops-stat__val">
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
                  </span>
                </div>
                <div className="ops-stat">
                  <span className="ops-stat__lab">告警</span>
                  <span className="ops-stat__val">
                    <Badge tone={alerts.length ? 'warn' : 'ok'}>
                      {alerts.length}
                    </Badge>
                  </span>
                </div>
              </div>
            </div>
            <ul className="ops-rail">
              <li>
                <span className="ops-rail__k">1 / 5 / 15</span>
                <code className="ops-rail__code">
                  {loadavg
                    ? loadavg.map((n) => n.toFixed(2)).join(' · ')
                    : '—'}
                </code>
              </li>
              <li>
                <span className="ops-rail__k">Mem</span>
                <span className="ops-rail__text">
                  {formatBytes(mem?.total)} · 可用 {formatBytes(mem?.free)}
                </span>
              </li>
              {disk ? (
                <li>
                  <span className="ops-rail__k">Disk</span>
                  <span className="ops-rail__text">
                    {disk.path ?? '/'} · {formatBytes(disk.total)} · 可用{' '}
                    {formatBytes(disk.free)}
                  </span>
                </li>
              ) : null}
            </ul>
          </section>

          <div className="ops-grid ops-grid--3">
            <section className="ops-panel">
              <header className="ops-panel__head">
                <h3 className="ops-panel__title">負載</h3>
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
              <div className="ops-meters">
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
                    <div key={row.lab} className="ops-meter">
                      <div className="ops-meter__head">
                        <span>{row.lab}</span>
                        <strong>
                          {row.v != null ? row.v.toFixed(2) : '—'}
                        </strong>
                      </div>
                      <div className="ops-meter__track">
                        <div
                          className="ops-meter__fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="ops-footnote">
                相對 {cpuCount || '?'} CPU；高於 1.0× 表示可能排隊。
              </p>
            </section>

            <section className="ops-panel">
              <header className="ops-panel__head">
                <h3 className="ops-panel__title">記憶體</h3>
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
              <div className="ops-meter ops-meter--lg">
                <div className="ops-meter__track ops-meter__track--lg">
                  <div
                    className={`ops-meter__fill${
                      memPct != null && memPct >= 90
                        ? ' ops-meter__fill--danger'
                        : memPct != null && memPct >= 75
                          ? ' ops-meter__fill--warn'
                          : ''
                    }`}
                    style={{ width: `${Math.min(100, memPct ?? 0)}%` }}
                  />
                </div>
              </div>
              <dl className="ops-dl">
                <div>
                  <dt>總量</dt>
                  <dd>{formatBytes(mem?.total)}</dd>
                </div>
                <div>
                  <dt>可用</dt>
                  <dd>{formatBytes(mem?.free)}</dd>
                </div>
              </dl>
            </section>

            <section className="ops-panel">
              <header className="ops-panel__head">
                <h3 className="ops-panel__title">磁碟</h3>
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
                  <div className="ops-meter ops-meter--lg">
                    <div className="ops-meter__track ops-meter__track--lg">
                      <div
                        className={`ops-meter__fill${
                          diskPct != null && diskPct >= 90
                            ? ' ops-meter__fill--danger'
                            : diskPct != null && diskPct >= 75
                              ? ' ops-meter__fill--warn'
                              : ''
                        }`}
                        style={{ width: `${Math.min(100, diskPct ?? 0)}%` }}
                      />
                    </div>
                  </div>
                  <dl className="ops-dl">
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
                <p className="ops-muted">無法讀取 statfs</p>
              )}
            </section>
          </div>

          <div className="ops-grid">
            <section className="ops-panel">
              <header className="ops-panel__head">
                <h3 className="ops-panel__title">告警</h3>
                <Badge tone={alerts.length ? 'warn' : 'ok'}>
                  {alerts.length}
                </Badge>
              </header>
              {alerts.length === 0 ? (
                <div className="ops-empty ops-empty--ok">
                  <strong>目前正常</strong>
                  <p>沒有記憶體／負載／磁碟閾值告警。</p>
                </div>
              ) : (
                <ul className="ops-alert-list">
                  {alerts.map((a) => (
                    <li key={a}>
                      <Badge tone="warn">{alertLabel(a)}</Badge>
                      <code>{a}</code>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="ops-panel">
              <header className="ops-panel__head">
                <h3 className="ops-panel__title">其他欄位</h3>
              </header>
              {facts.length === 0 ? (
                <p className="ops-muted">無額外指標</p>
              ) : (
                <dl className="ops-dl">
                  {facts.map((f) => (
                    <div key={f.label}>
                      <dt>{f.label}</dt>
                      <dd>{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <nav className="ops-shortcuts">
                <Link to="/system" className="ops-shortcut">
                  <span className="ops-shortcut__t">主機設定</span>
                  <span className="ops-shortcut__d">磁碟一覽 · 電源</span>
                </Link>
                <Link to="/services" className="ops-shortcut">
                  <span className="ops-shortcut__t">服務狀態</span>
                  <span className="ops-shortcut__d">systemd 矩陣</span>
                </Link>
              </nav>
            </section>
          </div>
        </div>
      ) : null}
    </FeaturePageLayout>
  );
}
