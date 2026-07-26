import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  KpiCard,
  KpiGrid,
  LoadingBlock,
  SummaryStrip,
} from '../../shared/components/ui';
import { api } from '../../shared/services/api';

/**
 * Host metrics — load, memory, alerts (equal-height KPI panels).
 */
export function MetricsPage() {
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

  const loadavg = Array.isArray(metrics?.loadavg) ? (metrics!.loadavg as number[]) : null;
  const mem =
    metrics?.memory && typeof metrics.memory === 'object'
      ? (metrics.memory as { usedRatio?: number; total?: number; free?: number })
      : null;
  const alerts = Array.isArray(metrics?.alerts) ? (metrics!.alerts as string[]) : [];
  const memPct = mem?.usedRatio != null ? Math.round(mem.usedRatio * 100) : null;

  const facts: Array<{ label: string; value: string }> = [];
  if (metrics) {
    for (const [k, v] of Object.entries(metrics)) {
      if (k === 'loadavg' || k === 'memory' || k === 'alerts') continue;
      if (v == null || typeof v === 'object') continue;
      facts.push({ label: k, value: String(v) });
    }
  }

  return (
    <FeaturePageLayout
      title="主機指標"
      subtitle="負載、記憶體與告警"
      showCapability={false}
      actions={
        <Button variant="secondary" size="md" onClick={() => void refresh()}>
          重新整理
        </Button>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading && !metrics ? <LoadingBlock /> : null}

      <SummaryStrip
        items={[
          {
            label: '負載 1 分',
            value: loadavg?.[0] != null ? loadavg[0].toFixed(2) : '—',
          },
          {
            label: '負載 5 分',
            value: loadavg?.[1] != null ? loadavg[1].toFixed(2) : '—',
          },
          {
            label: '負載 15 分',
            value: loadavg?.[2] != null ? loadavg[2].toFixed(2) : '—',
          },
          {
            label: '記憶體',
            value: memPct != null ? `${memPct}%` : '—',
            tone:
              memPct != null && memPct > 90
                ? 'danger'
                : memPct != null && memPct > 75
                  ? 'warn'
                  : 'default',
          },
          { label: 'CPU 數', value: String(metrics?.cpuCount ?? '—') },
        ]}
      />

      {alerts.length > 0 ? (
        <Alert variant="info">
          <div className="chip-row">
            {alerts.map((a) => (
              <span key={a} className="badge badge--warn">
                {a}
              </span>
            ))}
          </div>
        </Alert>
      ) : null}

      <KpiGrid cols={3}>
        <KpiCard
          label="負載"
          hint={metrics?.cpuCount != null ? `${String(metrics.cpuCount)} CPU` : '—'}
        >
          <p className="dash-kpi__value dash-kpi__value--sm">
            {loadavg
              ? loadavg.map((n) => (typeof n === 'number' ? n.toFixed(2) : String(n))).join(' · ')
              : '—'}
          </p>
          <p className="dash-kpi__meta">Load average（1 · 5 · 15 分）</p>
          <dl className="dash-kpi__facts">
            <div>
              <dt>1 分</dt>
              <dd>{loadavg?.[0] != null ? loadavg[0].toFixed(2) : '—'}</dd>
            </div>
            <div>
              <dt>15 分</dt>
              <dd>{loadavg?.[2] != null ? loadavg[2].toFixed(2) : '—'}</dd>
            </div>
          </dl>
        </KpiCard>

        <KpiCard
          label="記憶體"
          badge={
            memPct != null
              ? {
                  label: `${memPct}%`,
                  tone: memPct >= 90 ? 'danger' : memPct >= 75 ? 'warn' : 'ok',
                }
              : undefined
          }
        >
          <p className="dash-kpi__value">{memPct != null ? `${memPct}%` : '—'}</p>
          <p className="dash-kpi__meta">使用率</p>
          {memPct != null ? (
            <div className="dash-kpi__meter">
              <div
                className="dash-kpi__meter-track"
                role="progressbar"
                aria-valuenow={memPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={`dash-kpi__meter-fill${
                    memPct >= 90 ? ' is-danger' : memPct >= 75 ? ' is-warn' : ''
                  }`}
                  style={{ width: `${Math.min(100, memPct)}%` }}
                />
              </div>
            </div>
          ) : null}
          <dl className="dash-kpi__facts">
            <div>
              <dt>總量</dt>
              <dd>{mem?.total != null ? String(mem.total) : '—'}</dd>
            </div>
            <div>
              <dt>可用</dt>
              <dd>{mem?.free != null ? String(mem.free) : '—'}</dd>
            </div>
          </dl>
        </KpiCard>

        <KpiCard
          label="告警"
          hint={alerts.length > 0 ? `${alerts.length} 則` : '無'}
          badge={
            alerts.length > 0
              ? { label: String(alerts.length), tone: 'warn' }
              : { label: '0', tone: 'ok' }
          }
        >
          {alerts.length === 0 ? (
            <div className="dash-kpi__empty">
              <p className="dash-kpi__value dash-kpi__value--sm">正常</p>
              <p className="dash-kpi__meta">目前沒有指標告警</p>
            </div>
          ) : (
            <ul className="dash-kpi__list">
              {alerts.slice(0, 6).map((a) => (
                <li key={a}>
                  <span className="dash-kpi__list-name">{a}</span>
                </li>
              ))}
            </ul>
          )}
        </KpiCard>
      </KpiGrid>

      <Card>
        <CardSection title="詳細指標" description="其餘主機欄位（唯讀）">
          {facts.length > 0 ? (
            <DescriptionList columns={2} items={facts} />
          ) : (
            <p className="muted">無額外指標欄位</p>
          )}
        </CardSection>
      </Card>
    </FeaturePageLayout>
  );
}
