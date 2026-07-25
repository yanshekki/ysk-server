import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { api } from '../shared/services/api';

export function ProjectsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ProjectDto[]>([]);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await api.listProjects();
    setItems(r.items);
  }

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const r = await api.createProject({ name, domain: domain || undefined, runtime: 'node' });
      setMsg(`Created ${r.project.name}`);
      setName('');
      setDomain('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setBusy(true);
    try {
      await api.deleteProject(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-header">
        <h1>{t('projects.title')}</h1>
        <p>{t('projects.subtitle')}</p>
      </header>

      {error && <div className="alert alert--error">{error}</div>}
      {msg && <div className="alert alert--ok">{msg}</div>}

      <div className="card">
        <h2 className="card__title">{t('projects.create')}</h2>
        <form onSubmit={(e) => void onCreate(e)}>
          <div className="grid">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pname">{t('projects.name')}</label>
              <input id="pname" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pdomain">{t('projects.domain')}</label>
              <input
                id="pdomain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="app.example.com"
              />
            </div>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t('projects.create')}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="card__title">
          {t('projects.title')} ({items.length})
        </h2>
        {items.length === 0 ? (
          <div className="empty">
            <div className="empty__title">{t('projects.empty')}</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Runtime</th>
                  <th>Domain</th>
                  <th>Home</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>
                      <span className="badge">{p.runtime}</span>
                    </td>
                    <td className="muted">{p.domain ?? '—'}</td>
                    <td>
                      <code className="inline">{p.homeDir}</code>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={busy}
                        onClick={() => void onDelete(p.id)}
                      >
                        Delete
                      </button>
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
