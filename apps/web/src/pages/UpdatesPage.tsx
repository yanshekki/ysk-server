import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/services/api';

export function UpdatesPage() {
  const { t } = useTranslation();
  const [inventory, setInventory] = useState<
    Array<{ packageName: string; currentVersion: string; advice?: string; risk?: string }>
  >([]);
  const [selfUpdate, setSelfUpdate] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const inv = await api.requestRaw<{
          inventory: Array<{ packageName: string; currentVersion: string }>;
          advice: Array<{ packageName: string; advice: string; risk: string; currentVersion: string }>;
        }>('/api/v1/updates/inventory');
        const merged = inv.advice.map((a) => ({
          packageName: a.packageName,
          currentVersion: a.currentVersion,
          advice: a.advice,
          risk: a.risk,
        }));
        setInventory(merged.slice(0, 30));
        const self = await api.requestRaw<Record<string, unknown>>('/api/v1/updates/self');
        setSelfUpdate(self);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed');
      }
    })();
  }, []);

  return (
    <div>
      <header className="page-header">
        <h1>{t('updates.title')}</h1>
        <p>{t('updates.body')}</p>
      </header>
      {error && <div className="alert alert--error">{error}</div>}
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
        <h2 className="card__title">Package inventory / advice</h2>
        {inventory.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No packages</div>
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
                    <td>{i.advice ?? '—'}</td>
                    <td>
                      <span className="badge">{i.risk ?? '—'}</span>
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
