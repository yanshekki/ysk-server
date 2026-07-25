import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/services/api';

type Domain = {
  id: string;
  domain: string;
  health_score: number;
  server_ip: string;
  apply_status?: string;
  last_apply?: Record<string, unknown>;
};

type Bundle = {
  records: Array<{ type: string; name: string; value: string; description: string }>;
  externalTodos: Array<{ id: string; title: string; description: string; completed: boolean }>;
  health: { score: number; maxScore: number; messages: string[] };
};

export function EmailPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Domain[]>([]);
  const [domain, setDomain] = useState('');
  const [serverIp, setServerIp] = useState('203.0.113.10');
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await api.requestRaw<{ items: Domain[] }>('/api/v1/email/domains');
    setItems(r.items);
  }

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await api.requestRaw<Bundle & { domain: Domain }>('/api/v1/email/domains', {
        method: 'POST',
        body: JSON.stringify({ domain, serverIp }),
      });
      setBundle({
        records: created.records,
        externalTodos: created.externalTodos,
        health: created.health,
      });
      setDomain('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function loadDns(id: string) {
    setBusy(true);
    try {
      const b = await api.requestRaw<Bundle>(`/api/v1/email/domains/${id}/dns`);
      setBundle(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-header">
        <h1>{t('email.title')}</h1>
        <p>{t('email.externalTodos')}</p>
      </header>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="card">
        <h2 className="card__title">{t('email.create')}</h2>
        <form onSubmit={(e) => void onCreate(e)}>
          <div className="grid">
            <div className="field field--flush">
              <label htmlFor="edomain">Domain</label>
              <input
                id="edomain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                required
              />
            </div>
            <div className="field field--flush">
              <label htmlFor="eip">Server IP</label>
              <input id="eip" value={serverIp} onChange={(e) => setServerIp(e.target.value)} required />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t('email.create')}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="card__title">{t('email.domains')}</h2>
        {items.length === 0 ? (
          <div className="empty">
            <div className="empty__title">—</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Health</th>
                  <th>Apply</th>
                  <th>IP</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.domain}</strong>
                    </td>
                    <td>
                      <span className={`badge${d.health_score >= 80 ? ' badge--ok' : ' badge--warn'}`}>
                        {d.health_score}/100
                      </span>
                    </td>
                    <td>
                      <span className="badge">{d.apply_status ?? '—'}</span>
                    </td>
                    <td className="muted">{d.server_ip}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={busy}
                        onClick={() => void loadDns(d.id)}
                      >
                        DNS
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {bundle && (
        <div className="card">
          <h2 className="card__title">
            Health {bundle.health.score}/{bundle.health.maxScore}
          </h2>
          {bundle.health.messages.length > 0 && (
            <ul className="muted list-flush">
              {bundle.health.messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <h3 className="section-title">DNS records</h3>
          <div className="table-wrap u-mb-4">
            <table className="data">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {bundle.records.map((r, i) => (
                  <tr key={`${r.type}-${r.name}-${i}`}>
                    <td>
                      <span className="badge">{r.type}</span>
                    </td>
                    <td>{r.name}</td>
                    <td>
                      <code className="inline u-break-all">{r.value}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="section-title">{t('email.externalTodos')}</h3>
          <ul className="list-plain list-spaced">
            {bundle.externalTodos.map((todo) => (
              <li key={todo.id}>
                <strong>{todo.title}</strong>
                <div className="muted u-text-sm">{todo.description}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
