import { FormEvent } from 'react';
import { useAiTasks } from '../features/llm';

export function AiPage() {
  const {
    prompt,
    setPrompt,
    tasks,
    playbooks,
    error,
    busy,
    selected,
    setSelected,
    createTask,
    approveAndRun,
    runPlaybook,
  } = useAiTasks();

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await createTask(prompt);
    } catch {
      /* hook sets error */
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
            <input
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
            />
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
