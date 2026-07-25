import { FormEvent, useEffect, useState } from 'react';
import type { ProjectDto } from '@ysk/shared';
import { api } from '../shared/services/api';
import { authStore } from '../shared/stores/auth-store';

export function ProjectsPage() {
  const [items, setItems] = useState<ProjectDto[]>([]);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    if (!authStore.getToken()) {
      setError('Please login first');
      return;
    }
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
    try {
      const r = await api.createProject({ name, domain: domain || undefined, runtime: 'node' });
      setMsg(`Created ${r.project.name} at ${r.project.homeDir}`);
      setName('');
      setDomain('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    }
  }

  async function onDelete(id: string) {
    await api.deleteProject(id);
    await refresh();
  }

  return (
    <div>
      <div className="card">
        <h1>Projects</h1>
        <p className="muted">
          Each project gets a real directory under the control-plane dataDir. OS linux user is
          provisioned only with root + YSK_EXECUTE=1.
        </p>
        {error && <p className="error">{error}</p>}
        {msg && <p className="badge">{msg}</p>}
        <form onSubmit={onCreate}>
          <label className="muted">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
          <label className="muted">Domain (optional)</label>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="app.example.com" />
          <button type="submit">Create project</button>
        </form>
      </div>
      <div className="card">
        <h3>Existing ({items.length})</h3>
        <ul>
          {items.map((p) => (
            <li key={p.id} style={{ marginBottom: '0.75rem' }}>
              <strong>{p.name}</strong> — {p.runtime}
              {p.domain ? ` @ ${p.domain}` : ''}
              <br />
              <code className="muted">{p.homeDir}</code>
              <br />
              <button type="button" className="secondary" onClick={() => void onDelete(p.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
