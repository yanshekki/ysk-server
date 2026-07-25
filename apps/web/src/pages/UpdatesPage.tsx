import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/services/api';

type AdviceRow = {
  packageName: string;
  currentVersion: string;
  advice?: string;
  risk?: string;
  summary?: string;
  cves?: string[];
};

export function UpdatesPage() {
  const { t } = useTranslation();
  const [inventory, setInventory] = useState<AdviceRow[]>([]);
  const [selfUpdate, setSelfUpdate] = useState<Record<string, unknown> | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setError(null);
    setBusy(true);
    try {
      if (refresh) {
        const inv = await api.requestRaw<{
          inventory: Array<{ packageName: string; currentVersion: string }>;
          advice: AdviceRow[];
          collectedAt?: string;
        }>('/api/v1/updates/inventory/refresh', {
          method: 'POST',
          body: JSON.stringify({ osv: false }),
        });
        setInventory(inv.advice.slice(0, 40));
        setLastAt(inv.collectedAt ?? new Date().toISOString());
        setMsg(`Refreshed ${inv.inventory.length} packages`);
      } else {
        const inv = await api.requestRaw<{
          inventory: Array<{ packageName: string; currentVersion: string }>;
          advice: AdviceRow[];
          collectedAt?: string;
        }>('/api/v1/updates/inventory');
        const merged =
          inv.advice?.length > 0
            ? inv.advice
            : (inv.inventory ?? []).map((i) => ({
                packageName: i.packageName,
                currentVersion: i.currentVersion,
              }));
        setInventory(merged.slice(0, 40));
        setLastAt(inv.collectedAt ?? null);
      }
      const self = await api.requestRaw<Record<string, unknown>>('/api/v1/updates/self');
      setSelfUpdate(self);
      try {
        const sch = await api.requestRaw<{ jobs: Array<Record<string, unknown>> }>(
          '/api/v1/scheduler',
        );
        setJobs(sch.jobs);
      } catch {
        /* optional */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

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
