import { useTranslation } from 'react-i18next';
import { useUpdates } from '../features/updates';

export function UpdatesPage() {
  const { t } = useTranslation();
  const { inventory, selfUpdate, lastAt, jobs, error, busy, msg, load } = useUpdates();

  return (
    <div>
      <header className="page-header">
        <h1>{t('updates.title')}</h1>
        <p>{t('updates.body')}</p>
      </header>
      {error && <div className="alert alert--error">{error}</div>}
      {msg && <div className="alert alert--ok">{msg}</div>}

      <div className="form-actions btn-row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => void load(true)}
        >
          Refresh inventory
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={() => void load(false)}
        >
          Reload
        </button>
      </div>

      <div className="grid">
        <div className="card">
          <h2 className="card__title">Self-update plan</h2>
          {selfUpdate ? (
            <pre className="code">{JSON.stringify(selfUpdate, null, 2)}</pre>
          ) : (
            <div className="loading-row">
              <div className="spinner" />
              <span className="muted">Loading…</span>
            </div>
          )}
        </div>
        <div className="card">
          <h2 className="card__title">Scheduler</h2>
          {jobs.length === 0 ? (
            <p className="muted">No jobs (or scheduler disabled)</p>
          ) : (
            <ul className="list-plain list-spaced">
              {jobs.map((j) => (
                <li key={String(j.id)}>
                  <code className="inline">{String(j.id)}</code>{' '}
                  <span className="muted">
                    every {String(j.intervalMs)}ms · last {String(j.lastRunAt ?? '—')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {lastAt && <p className="muted meta-block--top">Inventory at: {lastAt}</p>}
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">Package inventory / advice</h2>
        {inventory.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No packages</div>
            <p className="muted">Click Refresh inventory to scan the host</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Version</th>
                  <th>Advice</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((i) => (
                  <tr key={i.packageName + i.currentVersion}>
                    <td>
                      <code className="inline">{i.packageName}</code>
                    </td>
                    <td>{i.currentVersion}</td>
                    <td>{i.advice ?? i.summary ?? '—'}</td>
                    <td>
                      <span
                        className={
                          i.risk === 'critical' || i.risk === 'high'
                            ? 'badge badge--danger'
                            : i.risk === 'medium'
                              ? 'badge badge--warn'
                              : 'badge'
                        }
                      >
                        {i.risk ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
