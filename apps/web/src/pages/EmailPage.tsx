import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authStore } from '../shared/stores/auth-store';

type Domain = { id: string; domain: string; health_score: number; server_ip: string };

export function EmailPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Domain[]>([]);
  const [domain, setDomain] = useState('');
  const [serverIp, setServerIp] = useState('203.0.113.10');
  const [bundle, setBundle] = useState<{
    records: Array<{ type: string; name: string; value: string; description: string }>;
    externalTodos: Array<{ id: string; title: string; description: string; completed: boolean }>;
    health: { score: number; maxScore: number; messages: string[] };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const token = authStore.getToken();
    const res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? res.statusText);
    return data as T;
  }

  async function refresh() {
    if (!authStore.getToken()) {
      setError('Please login first');
      return;
    }
    const r = await api<{ items: Domain[] }>('/api/v1/email/domains');
    setItems(r.items);
  }

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api<{
        domain: Domain;
        records: typeof bundle extends null ? never : NonNullable<typeof bundle>['records'];
        externalTodos: NonNullable<typeof bundle>['externalTodos'];
        health: NonNullable<typeof bundle>['health'];
      }>('/api/v1/email/domains', {
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
    }
  }

  async function loadDns(id: string) {
    const b = await api<NonNullable<typeof bundle>>(`/api/v1/email/domains/${id}/dns`);
    setBundle(b);
  }

  return (
    <div>
      <div className="card">
        <h1>{t('email.title')}</h1>
        <p className="muted">{t('email.externalTodos')}</p>
        {error && <p className="error">{error}</p>}
        <form onSubmit={onCreate}>
          <label className="muted">Domain</label>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" required />
          <label className="muted">Server IP</label>
          <input value={serverIp} onChange={(e) => setServerIp(e.target.value)} required />
          <button type="submit">Create email domain (real DKIM keys)</button>
        </form>
      </div>
      <div className="card">
        <h3>Domains</h3>
        <ul>
          {items.map((d) => (
            <li key={d.id}>
              <strong>{d.domain}</strong> — health {d.health_score}/100{' '}
              <button type="button" className="secondary" onClick={() => void loadDns(d.id)}>
                Show DNS / checklist
              </button>
            </li>
          ))}
        </ul>
      </div>
      {bundle && (
        <div className="card">
          <h3>
            Health {bundle.health.score}/{bundle.health.maxScore}
          </h3>
          <ul>
            {bundle.health.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <h4>DNS records (copy to DNS provider)</h4>
          <pre style={{ fontSize: 12, overflow: 'auto' }}>
            {bundle.records.map((r) => `${r.type}\t${r.name}\t${r.value}\n`).join('')}
          </pre>
          <h4>{t('email.externalTodos')}</h4>
          <ul>
            {bundle.externalTodos.map((t) => (
              <li key={t.id}>
                <strong>{t.title}</strong>
                <br />
                <span className="muted">{t.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
