import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/services/api';
import { authStore } from '../shared/stores/auth-store';

export function SecurityPage() {
  const { t } = useTranslation();
  const [tools, setTools] = useState<Array<Record<string, unknown>>>([]);
  const [approvals, setApprovals] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function refresh() {
    if (!authStore.getToken()) return;
    const [tRes, aRes] = await Promise.all([api.listTools(), api.listApprovals()]);
    setTools(tRes.items);
    setApprovals(aRes.items);
  }

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function runSysInfo() {
    setError(null);
    try {
      const r = await api.executeTool({ tool: 'sys.info', args: {} });
      setResult(JSON.stringify(r, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    }
  }

  async function approve(id: string) {
    await api.approve(id);
    await refresh();
  }

  return (
    <div>
      <div className="card">
        <h1>{t('security.title')}</h1>
        <p>{t('security.allowlist')}</p>
        <p>{t('security.llmUntrusted')}</p>
        {error && <p className="error">{error}</p>}
        <button type="button" onClick={() => void runSysInfo()}>
          Run sys.info (real)
        </button>
        {result && (
          <pre style={{ overflow: 'auto', maxHeight: 240, fontSize: 12 }}>{result}</pre>
        )}
      </div>
      <div className="card">
        <h3>Pending approvals</h3>
        <ul>
          {approvals.map((a) => (
            <li key={String(a.id)}>
              {String(a.action)} — {String(a.risk)}{' '}
              <button type="button" onClick={() => void approve(String(a.id))}>
                Approve
              </button>
            </li>
          ))}
          {!approvals.length && <li className="muted">None</li>}
        </ul>
      </div>
      <div className="card">
        <h3>Allowlist tools ({tools.length})</h3>
        <ul>
          {tools.map((t) => (
            <li key={String(t.tool)}>
              <code>{String(t.tool)}</code> — allowed={String(t.allowed)} risk={String(t.risk)}{' '}
              approval={String(t.requiresApproval)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
