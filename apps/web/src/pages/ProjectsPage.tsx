import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto, OpsApplyResultDto } from '@ysk/shared';
import { api } from '../shared/services/api';

export function ProjectsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ProjectDto[]>([]);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ProjectDto | null>(null);
  const [opsLog, setOpsLog] = useState<OpsApplyResultDto | null>(null);

  async function refresh() {
    const r = await api.listProjects();
    setItems(r.items);
    if (selected) {
      const updated = r.items.find((p) => p.id === selected.id) ?? null;
      setSelected(updated);
    }
  }

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setSelected(r.project);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteProject(id);
      if (selected?.id === id) {
        setSelected(null);
        setOpsLog(null);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function runOps(
    action: 'deploy' | 'stop' | 'health' | 'publish-nginx',
    id: string,
  ) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      let result: OpsApplyResultDto;
      if (action === 'deploy') result = await api.deployProject(id);
      else if (action === 'stop') result = await api.stopProject(id);
      else if (action === 'health') result = await api.projectHealth(id);
      else result = await api.publishNginx(id);

      setOpsLog(result);
      setMsg(
        result.ok
          ? `${action} OK` + (result.url ? ` → ${result.url}` : '')
          : `${action} failed: ${result.notes?.slice(-1)[0] ?? 'see log'}`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
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
            <div className="field field--flush">
              <label htmlFor="pname">{t('projects.name')}</label>
              <input id="pname" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field field--flush">
              <label htmlFor="pdomain">{t('projects.domain')}</label>
              <input
                id="pdomain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="app.example.com"
              />
            </div>
          </div>
          <div className="form-actions">
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
                  <th>Status</th>
                  <th>Port</th>
                  <th>Domain</th>
                  <th>PID</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className={selected?.id === p.id ? 'is-selected' : undefined}>
                    <td>
                      <button
                        type="button"
                        className="btn btn--link"
                        onClick={() => {
                          setSelected(p);
                          setOpsLog(null);
                        }}
                      >
                        <strong>{p.name}</strong>
                      </button>
                    </td>
                    <td>
                      <span
                        className={
                          p.processStatus === 'running'
                            ? 'badge badge--ok'
                            : p.processStatus === 'unhealthy' || p.processStatus === 'failed'
                              ? 'badge badge--danger'
                              : 'badge'
                        }
                      >
                        {p.processStatus ?? p.status ?? '—'}
                      </span>
                    </td>
                    <td className="muted">{p.port ?? '—'}</td>
                    <td className="muted">{p.domain ?? '—'}</td>
                    <td className="muted">{p.pid ?? '—'}</td>
                    <td>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={busy}
                          onClick={() => void runOps('deploy', p.id)}
                        >
                          {t('projects.deploy')}
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() => void runOps('health', p.id)}
                        >
                          {t('projects.health')}
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() => void onDelete(p.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="card">
          <h2 className="card__title">
            {t('projects.detail')}: {selected.name}
          </h2>
          <dl className="kv">
            <div>
              <dt>ID</dt>
              <dd>
                <code className="inline">{selected.id}</code>
              </dd>
            </div>
            <div>
              <dt>Home</dt>
              <dd>
                <code className="inline">{selected.homeDir}</code>
              </dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>
                <span className="badge">{selected.runtime}</span> {selected.runtimeVersion ?? ''}
              </dd>
            </div>
            <div>
              <dt>Process</dt>
              <dd>
                {selected.processStatus ?? '—'} · port {selected.port ?? '—'} · pid{' '}
                {selected.pid ?? '—'}
              </dd>
            </div>
            <div>
              <dt>Nginx</dt>
              <dd>
                <code className="inline">{selected.nginxConfigPath ?? '—'}</code>
              </dd>
            </div>
            <div>
              <dt>Last deploy</dt>
              <dd className="muted">{selected.lastDeployAt ?? '—'}</dd>
            </div>
            <div>
              <dt>Last health</dt>
              <dd>
                <pre className="code">
                  {selected.lastHealth
                    ? JSON.stringify(selected.lastHealth, null, 2)
                    : '—'}
                </pre>
              </dd>
            </div>
          </dl>
          <div className="form-actions btn-row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void runOps('deploy', selected.id)}
            >
              {t('projects.deploy')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void runOps('publish-nginx', selected.id)}
            >
              {t('projects.publishNginx')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void runOps('health', selected.id)}
            >
              {t('projects.health')}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={() => void runOps('stop', selected.id)}
            >
              {t('projects.stop')}
            </button>
          </div>
          {opsLog && (
            <div className="u-mt-4">
              <h3 className="section-title">{t('projects.opsResult')}</h3>
              <pre className="code code--spaced">{JSON.stringify(opsLog, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
