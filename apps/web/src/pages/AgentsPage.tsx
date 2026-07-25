import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgents } from '../features/agents';

export function AgentsPage() {
  const { t } = useTranslation();
  const {
    agents,
    runtimes,
    error,
    busy,
    msg,
    detail,
    refresh,
    register,
    probeKind,
    writeUnit,
    installKind,
    showPlan,
  } = useAgents();
  const [agentId, setAgentId] = useState('edge-1');

  return (
    <div>
      <header className="page-header">
        <h1>{t('agents.title')}</h1>
        <p>{t('agents.body')}</p>
      </header>
      {error && <div className="alert alert--error">{error}</div>}
      {msg && <div className="alert alert--ok">{msg}</div>}

      <div className="card">
        <h2 className="card__title">Managed runtimes (probe)</h2>
        <div className="form-actions btn-row">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh probes
          </button>
        </div>
        <div className="grid">
          {(runtimes.length
            ? runtimes
            : [
                { kind: 'openclaw', name: 'OpenClaw', status: 'unknown' },
                { kind: 'hermes', name: 'Hermes', status: 'unknown' },
                { kind: 'ionclaw', name: 'IonClaw', status: 'unknown' },
              ]
          ).map((rt) => (
            <div className="card" key={rt.kind}>
              <h2 className="card__title">{rt.name ?? rt.kind}</h2>
              <p>
                <span
                  className={
                    rt.status === 'running'
                      ? 'badge badge--ok'
                      : rt.status === 'not_installed'
                        ? 'badge badge--warn'
                        : 'badge'
                  }
                >
                  {rt.status}
                </span>
              </p>
              {rt.installPath && (
                <p className="muted u-text-sm">
                  <code className="inline">{rt.installPath}</code>
                  {rt.pathExists != null && (rt.pathExists ? ' (exists)' : ' (missing)')}
                </p>
              )}
              {rt.unitActive && (
                <p className="muted u-text-sm">
                  unit {rt.unitName}: {rt.unitActive}
                </p>
              )}
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  onClick={() => void probeKind(rt.kind)}
                >
                  Probe
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  onClick={() => void showPlan(rt.kind)}
                >
                  Install plan
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={busy}
                  onClick={() => void writeUnit(rt.kind)}
                >
                  Write unit
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  onClick={() => void installKind(rt.kind, false)}
                >
                  Install (safe)
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {detail && (
        <div className="card">
          <h2 className="card__title">Detail</h2>
          <pre className="code">{JSON.stringify(detail, null, 2)}</pre>
        </div>
      )}

      <div className="card">
        <h2 className="card__title">Register fleet agent session</h2>
        <div className="field">
          <label htmlFor="aid">Agent ID</label>
          <input id="aid" value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void register(agentId)}
          >
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
    </div>
  );
}
