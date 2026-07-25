import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/services/api';

type FleetAgent = {
  id: string;
  agent_id: string;
  status: string;
  group?: string;
  last_seen_at: string;
};

type RuntimeProbe = {
  kind: string;
  name: string;
  status: string;
  installPath?: string;
  pathExists?: boolean;
  unitActive?: string;
  unitName?: string;
  notes?: string[];
  installPlan?: string[];
  supervision?: string[];
  probedAt?: string;
};

export function AgentsPage() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeProbe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('edge-1');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  async function refreshFleet() {
    const r = await api.requestRaw<{ items: FleetAgent[] }>('/api/v1/fleet/agents');
    setAgents(r.items);
  }

  async function refreshRuntimes() {
    const r = await api.requestRaw<{ items: RuntimeProbe[] }>('/api/v1/agents/runtimes');
    setRuntimes(r.items);
  }

  useEffect(() => {
    void (async () => {
      try {
        await refreshFleet();
        await refreshRuntimes();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed');
      }
    })();
  }, []);

  async function register() {
    setError(null);
    try {
      await api.requestRaw('/api/v1/fleet/agents/register', {
        method: 'POST',
        body: JSON.stringify({ agentId, group: 'default' }),
      });
      await refreshFleet();
      setMsg(`Registered ${agentId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    }
  }

  async function probeKind(kind: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestRaw<{ runtime: RuntimeProbe }>(
        `/api/v1/agents/runtimes/${kind}`,
      );
      setDetail(r.runtime as unknown as Record<string, unknown>);
      await refreshRuntimes();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'probe failed');
    } finally {
      setBusy(false);
    }
  }

  async function writeUnit(kind: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestRaw<Record<string, unknown>>(
        `/api/v1/agents/runtimes/${kind}/unit`,
        { method: 'POST', body: '{}' },
      );
      setDetail(r);
      setMsg(`Unit written for ${kind}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unit failed');
    } finally {
      setBusy(false);
    }
  }

  async function showPlan(kind: string) {
    setBusy(true);
    try {
      const r = await api.requestRaw<Record<string, unknown>>(
        `/api/v1/agents/runtimes/${kind}/plan`,
        { method: 'POST', body: '{}' },
      );
      setDetail(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'plan failed');
    } finally {
      setBusy(false);
    }
  }

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
            onClick={() => void refreshRuntimes()}
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
    </div>
  );
}
