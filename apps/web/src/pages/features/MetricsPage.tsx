import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  LoadingBlock,
  SummaryStrip,
} from '../../shared/components/ui';
import { api } from '../../shared/services/api';

/**
 * Host metrics — load, memory, alerts.
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
      setError(e instanceof Error ? e.message : 'metrics failed');
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
  const alerts = Array.isArray(metrics?.alerts) ? (metrics!.alerts as string[]) : [];

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
            label: 'Load 1m',
            value: loadavg?.[0] != null ? loadavg[0].toFixed(2) : '—',
          },
          {
            label: 'Load 5m',
            value: loadavg?.[1] != null ? loadavg[1].toFixed(2) : '—',
          },
          {
            label: 'Load 15m',
            value: loadavg?.[2] != null ? loadavg[2].toFixed(2) : '—',
          },
          {
            label: 'Mem used',
            value:
              mem?.usedRatio != null ? `${Math.round(mem.usedRatio * 100)}%` : '—',
            tone:
              mem?.usedRatio != null && mem.usedRatio > 0.9
                ? 'danger'
                : mem?.usedRatio != null && mem.usedRatio > 0.75
                  ? 'warn'
                  : 'default',
          },
          { label: 'CPUs', value: String(metrics?.cpuCount ?? '—') },
        ]}
      />

      {alerts.length > 0 ? (
        <Alert variant="info">
          <div className="btn-row">
            {alerts.map((a) => (
              <span key={a} className="badge badge--warn">
                {a}
              </span>
            ))}
          </div>
        </Alert>
      ) : null}

      <Card>
        <CardSection title="詳細指標">
          {facts.length > 0 ? (
            <DescriptionList columns={2} items={facts} />
          ) : (
            <p className="muted">無額外指標欄位</p>
          )}
          {mem ? (
            <div className="u-mt-4">
              <DescriptionList
                columns={2}
                items={[
                  {
                    label: '記憶體使用率',
                    value:
                      mem.usedRatio != null
                        ? `${Math.round(mem.usedRatio * 100)}%`
                        : '—',
                  },
                  {
                    label: '記憶體總量',
                    value: mem.total != null ? String(mem.total) : '—',
                  },
                  {
                    label: '可用記憶體',
                    value: mem.free != null ? String(mem.free) : '—',
                  },
                ]}
              />
            </div>
          ) : null}
        </CardSection>
      </Card>
    </FeaturePageLayout>
  );
}
