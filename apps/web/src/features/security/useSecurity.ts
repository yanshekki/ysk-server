/**
 * Security feature — allowlist tools + approval queue.
 */
import { useCallback, useEffect, useState } from 'react';
import { securityApi } from './api';

export function useSecurity() {
  const [tools, setTools] = useState<Array<Record<string, unknown>>>([]);
  const [approvals, setApprovals] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [tRes, aRes] = await Promise.all([
      securityApi.listTools(),
      securityApi.listApprovals(),
    ]);
    setTools(Array.isArray(tRes.items) ? (tRes.items as Array<Record<string, unknown>>) : []);
    setApprovals(Array.isArray(aRes.items) ? (aRes.items as Array<Record<string, unknown>>) : []);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const runSysInfo = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await securityApi.executeTool({ tool: 'sys.info', args: {} });
      setResult(JSON.stringify(r, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const approve = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await securityApi.approve(id);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed');
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return { tools, approvals, error, result, busy, refresh, runSysInfo, approve };
}
