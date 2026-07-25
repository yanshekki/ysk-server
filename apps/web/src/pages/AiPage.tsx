import { FormEvent, useEffect, useState } from 'react';
import { api } from '../shared/services/api';

type Task = {
  id: string;
  prompt: string;
  status: string;
  planSummary: string;
  steps: Array<{ id: string; tool: string; status: string; requiresApproval: boolean; error?: string }>;
};

export function AiPage() {
  const [prompt, setPrompt] = useState('show system info');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [playbooks, setPlaybooks] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);

  async function refresh() {
    const [t, p] = await Promise.all([
      api.requestRaw<{ items: Task[] }>('/api/v1/ai/tasks'),
      api.requestRaw<{ items: Array<{ id: string; name: string; description: string }> }>(
        '/api/v1/ai/playbooks',
      ),
    ]);
    setTasks(t.items);
    setPlaybooks(p.items);
  }

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const task = await api.requestRaw<Task>('/api/v1/ai/tasks', {
        method: 'POST',
        body: JSON.stringify({ prompt, enrich: false }),
      });
      setSelected(task);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function approveAndRun(id: string) {
    setBusy(true);
    try {
      await api.requestRaw(`/api/v1/ai/tasks/${id}/approve`, { method: 'POST' });
      const done = await api.requestRaw<Task>(`/api/v1/ai/tasks/${id}/execute`, { method: 'POST' });
      setSelected(done);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function runPlaybook(id: string) {
    setBusy(true);
    try {
      const r = await api.requestRaw<{ task: Task }>('/api/v1/ai/playbooks/run', {
        method: 'POST',
        body: JSON.stringify({ playbookId: id }),
      });
      setSelected(r.task);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-header">
        <h1>AI 任務</h1>
        <p>Plan → Review → Execute（只經 Allowlist / 審批，從不直接執行模型字串）</p>
      </header>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="card">
        <h2 className="card__title">建立任務</h2>
        <form onSubmit={(e) => void onCreate(e)}>
          <div className="field">
            <label htmlFor="prompt">自然語言指令</label>
            <input id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              產生計劃
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="card__title">Playbooks</h2>
        <div className="grid">
          {playbooks.map((p) => (
            <div key={p.id} className="card">
              <h3 className="card__title">{p.name}</h3>
              <p className="card__desc">{p.description}</p>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={() => void runPlaybook(p.id)}
              >
                執行
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">最近任務</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Prompt</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.prompt}</td>
                  <td>
                    <span className="badge">{t.status}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => setSelected(t)}
                    >
                      查看
                    </button>{' '}
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={busy}
                      onClick={() => void approveAndRun(t.id)}
                    >
                      批准並執行
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="card">
          <h2 className="card__title">計劃詳情</h2>
          <p className="muted">{selected.planSummary}</p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Status</th>
                  <th>Approval</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {selected.steps.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <code className="inline">{s.tool}</code>
                    </td>
                    <td>{s.status}</td>
                    <td>{String(s.requiresApproval)}</td>
                    <td className="muted">{s.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
