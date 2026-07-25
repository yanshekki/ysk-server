import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/services/api';
import type { HealthResponse } from '@ysk/shared';
import { useAuth } from '../shared/hooks/useAuth';

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await api.health();
        if (!cancelled) setHealth(h);
        const a = await api.audit();
        if (!cancelled) setAudit(a.items.slice(0, 12));
        const m = await api.requestRaw<Record<string, unknown>>('/api/v1/metrics');
        if (!cancelled) setMetrics(m);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <header className="page-header">
        <h1>{t('dashboard.title')}</h1>
        <p>
          {t('dashboard.welcome')}
          {user ? ` — ${user.username}` : ''}
        </p>
      </header>

      {error && <div className="alert alert--error">{error}</div>}
      {loading && (
        <div className="card loading-row">
          <div className="spinner" />
          <span className="muted">Loading…</span>
        </div>
      )}

      <div className="grid">
        <div className="card">
          <h2 className="card__title">{t('dashboard.health')}</h2>
          {health && (
            <>
              <p className="meta-block">
                <span className={`badge${health.status === 'ok' ? ' badge--ok' : ' badge--warn'}`}>
                  {health.status}
                </span>
              </p>
              <p className="muted meta-block--tight">
                {health.product} · v{health.version}
              </p>
              <p className="meta-block--top">
                {t('dashboard.protection')}:{' '}
                <strong className="u-font-bold">{health.protectionMode}</strong>
              </p>
            </>
          )}
        </div>

        <div className="card">
          <h2 className="card__title">Host metrics</h2>
          {metrics ? (
            <>
              <p className="meta-block">
                Load: <strong>{JSON.stringify(metrics.loadavg)}</strong>
              </p>
              <p className="muted meta-block--tight">
                CPUs: {String(metrics.cpuCount)} · Mem used:{' '}
                {metrics.memory && typeof metrics.memory === 'object'
                  ? `${Math.round(((metrics.memory as { usedRatio: number }).usedRatio || 0) * 100)}%`
                  : '—'}
              </p>
              {Array.isArray(metrics.alerts) && metrics.alerts.length > 0 && (
                <p className="meta-block--top">
                  {(metrics.alerts as string[]).map((a) => (
                    <span key={a} className="badge badge--warn">
                      {a}
                    </span>
                  ))}
                </p>
              )}
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </div>

        <div className="card">
          <h2 className="card__title">{t('dashboard.audit')}</h2>
          {audit.length === 0 ? (
            <div className="empty">
              <div className="empty__title">—</div>
              <p className="muted">{t('dashboard.needLogin')}</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={String(a.id)}>
                      <td>
                        <code className="inline">{String(a.action)}</code>
                      </td>
                      <td>{String(a.actor)}</td>
                      <td className="muted u-nowrap">
                        {String(a.created_at).replace('T', ' ').slice(0, 19)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
