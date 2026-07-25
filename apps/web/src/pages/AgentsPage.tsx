import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/services/api';

export function AgentsPage() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<
    Array<{ id: string; agent_id: string; status: string; group?: string; last_seen_at: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('edge-1');

  async function refresh() {
    const r = await api.requestRaw<{ items: typeof agents }>('/api/v1/fleet/agents');
    setAgents(r.items);
  }

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function register() {
    setError(null);
    try {
      await api.requestRaw('/api/v1/fleet/agents/register', {
        method: 'POST',
        body: JSON.stringify({ agentId, group: 'default' }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    }
  }

  return (
    <div>
      <header className="page-header">
        <h1>{t('agents.title')}</h1>
        <p>{t('agents.body')}</p>
      </header>
      {error && <div className="alert alert--error">{error}</div>}
      <div className="card">
        <h2 className="card__title">Register agent session</h2>
        <div className="field">
          <label htmlFor="aid">Agent ID</label>
          <input id="aid" value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--primary" onClick={() => void register()}>
            Register
          </button>
        </div>
      </div>
      <div className="card">
        <h2 className="card__title">Fleet agents ({agents.length})</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th>Group</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>{a.agent_id}</td>
                  <td>
                    <span className="badge">{a.status}</span>
                  </td>
                  <td>{a.group ?? '—'}</td>
                  <td className="muted u-nowrap">{a.last_seen_at?.slice(0, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid">
        {['openclaw', 'hermes', 'ionclaw'].map((k) => (
          <div className="card" key={k}>
            <h2 className="card__title">{k}</h2>
            <p className="card__desc">Runtime kind managed via install plan + systemd unit under dataDir.</p>
            <span className="badge badge--warn">managed</span>
          </div>
        ))}
      </div>
    </div>
  );
}
