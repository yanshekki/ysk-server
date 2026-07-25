import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/services/api';

export function SecurityPage() {
  const { t } = useTranslation();
  const [tools, setTools] = useState<Array<Record<string, unknown>>>([]);
  const [approvals, setApprovals] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [tRes, aRes] = await Promise.all([api.listTools(), api.listApprovals()]);
    setTools(tRes.items);
    setApprovals(aRes.items);
  }

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function runSysInfo() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.executeTool({ tool: 'sys.info', args: {} });
      setResult(JSON.stringify(r, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    setBusy(true);
    try {
      await api.approve(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-header">
        <h1>{t('security.title')}</h1>
        <p>{t('security.allowlist')}</p>
      </header>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="alert alert--info">{t('security.llmUntrusted')}</div>

      <div className="card">
        <h2 className="card__title">Host probe</h2>
        <p className="card__desc">Run a real read-only tool against the control-plane host.</p>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void runSysInfo()}>
          {t('security.runSysInfo')}
        </button>
        {result && <pre className="code code--spaced">{result}</pre>}
      </div>

      <div className="card">
        <h2 className="card__title">{t('security.pending')}</h2>
        {approvals.length === 0 ? (
          <div className="empty">
            <div className="empty__title">{t('security.none')}</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Risk</th>
                  <th>By</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {approvals.map((a) => (
                  <tr key={String(a.id)}>
                    <td>
                      <code className="inline">{String(a.action)}</code>
                    </td>
                    <td>
                      <span className="badge badge--warn">{String(a.risk)}</span>
                    </td>
                    <td>{String(a.requestedBy ?? a.requested_by ?? '—')}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={busy}
                        onClick={() => void approve(String(a.id))}
                      >
                        Approve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="card__title">Allowlist ({tools.length})</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Allowed</th>
                <th>Risk</th>
                <th>Approval</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr key={String(tool.tool)}>
                  <td>
                    <code className="inline">{String(tool.tool)}</code>
                  </td>
                  <td>
                    <span className={`badge${tool.allowed ? ' badge--ok' : ' badge--danger'}`}>
                      {String(tool.allowed)}
                    </span>
                  </td>
                  <td>{String(tool.risk)}</td>
                  <td>{String(tool.requiresApproval)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
