import { useTranslation } from 'react-i18next';
import { useAuth } from '../shared/hooks/useAuth';
import { useDashboard } from '../features/dashboard';

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { health, audit, metrics, projects, backups, summary, readiness, error, loading } =
    useDashboard();

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

      {readiness && (
        <div
          className={`alert${readiness.productionReady ? ' alert--ok' : ' alert--info'}`}
        >
          <strong>Spec readiness:</strong>{' '}
          {readiness.productionReady ? 'productionReady' : 'not fully production-capable'} · mode=
          {readiness.mode} · score {readiness.score.ready}/{readiness.score.total} ready
          {readiness.summary[1] ? ` — ${readiness.summary[1]}` : ''}
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
          <h2 className="card__title">Projects</h2>
          {projects.length === 0 ? (
            <p className="muted">No projects yet</p>
          ) : (
            <ul className="list-plain list-spaced">
              {projects.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong>{' '}
                  <span
                    className={
                      p.processStatus === 'running' ? 'badge badge--ok' : 'badge'
                    }
                  >
                    {p.processStatus ?? p.status ?? '—'}
                  </span>
                  {p.port != null && <span className="muted"> :{p.port}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="muted meta-block--top">Backups on disk: {backups}</p>
        </div>

        <div className="card">
          <h2 className="card__title">Ops summary</h2>
          {summary ? (
            <>
              <p className="meta-block">
                Projects running:{' '}
                <strong>
                  {String(
                    (summary.projects as { running?: number; total?: number })?.running ?? 0,
                  )}
                  /
                  {String((summary.projects as { total?: number })?.total ?? 0)}
                </strong>
              </p>
              <p className="muted meta-block--tight">
                Email domains:{' '}
                {String((summary.email as { domains?: number })?.domains ?? 0)}
                {(summary.email as { smtpRelay?: unknown })?.smtpRelay
                  ? ' · relay configured'
                  : ''}
              </p>
              <p className="muted meta-block--tight">
                DNSBL last:{' '}
                {String(
                  (
                    (summary.email as { lastDnsbl?: { at?: string } })?.lastDnsbl
                      ?.at as string
                  )?.slice(0, 19) ?? '—',
                )}
              </p>
              <ul className="list-plain list-spaced u-mt-4">
                {(
                  (summary.agents as { items?: Array<{ kind: string; status: string }> })
                    ?.items ?? []
                ).map((a) => (
                  <li key={a.kind}>
                    <code className="inline">{a.kind}</code>{' '}
                    <span
                      className={
                        a.status === 'running' ? 'badge badge--ok' : 'badge badge--warn'
                      }
                    >
                      {a.status}
                    </span>
                  </li>
                ))}
              </ul>
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
