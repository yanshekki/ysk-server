/**
 * Agents feature — fleet + runtimes hooks (panel executes installs).
 */
import { useCallback, useEffect, useState } from 'react';
import { agentsApi, type FleetAgent, type RuntimeProbe } from './api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

export function useAgents() {
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeProbe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [detailNotes, setDetailNotes] = useState<string[]>([]);
  const [detailFacts, setDetailFacts] = useState<Array<{ label: string; value: string }>>([]);

  const refresh = useCallback(async () => {
    const [fleet, rts] = await Promise.all([agentsApi.listFleet(), agentsApi.listRuntimes()]);
    setAgents(fleet.items);
    setRuntimes(rts.items);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const presentResult = useCallback((r: Record<string, unknown>, fallbackMsg: string) => {
    const notes = sanitizeOperatorNotes(
      Array.isArray(r.notes) ? r.notes.map(String) : r.message ? [String(r.message)] : [],
    );
    setDetailNotes(notes);
    const FACT_LABELS: Record<string, string> = {
      kind: '類型',
      name: '名稱',
      status: '狀態',
      unitActive: '服務',
      unitName: '單元',
      pathExists: '路徑存在',
      installPath: '安裝路徑',
    };
    const facts: Array<{ label: string; value: string }> = [];
    for (const [k, v] of Object.entries(r)) {
      if (
        k === 'notes' ||
        k === 'commands' ||
        k === 'commandResults' ||
        k === 'installPlan' ||
        k === 'requiresExecute' ||
        k === 'requiresRoot' ||
        k === 'ok' ||
        k === 'probedAt' ||
        typeof v === 'object'
      ) {
        continue;
      }
      facts.push({ label: FACT_LABELS[k] ?? k, value: String(v) });
    }
    setDetailFacts(facts.slice(0, 12));
    const blocked = Boolean(
      r.ok === false && (r.requiresExecute || notes.some((n) => /權限|無法在管理面板/.test(n))),
    );
    setMsg(blocked ? notes[0] ?? '無法在管理面板完成安裝' : fallbackMsg);
  }, []);

  const register = useCallback(
    async (agentId: string, group = 'default') => {
      setBusy(true);
      setError(null);
      try {
        await agentsApi.register({ agentId, group });
        await refresh();
        setMsg(`已登記 ${agentId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : '登記失敗');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const probeKind = useCallback(
    async (kind: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = await agentsApi.probe(kind);
        presentResult((r.runtime as Record<string, unknown>) ?? (r as Record<string, unknown>), `已探測 ${kind}`);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : '探測失敗');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, presentResult],
  );

  const writeUnit = useCallback(
    async (kind: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = (await agentsApi.writeUnit(kind)) as Record<string, unknown>;
        presentResult(r, `已寫入 ${kind} 服務設定`);
      } catch (e) {
        setError(e instanceof Error ? e.message : '寫入失敗');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [presentResult],
  );

  /** Always try real install from panel (execute=true). */
  const installKind = useCallback(
    async (kind: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = (await agentsApi.install(kind, true)) as Record<string, unknown>;
        presentResult(
          r,
          r.ok ? `已安裝 ${kind}` : '安裝未完成',
        );
        await refresh();
        return r;
      } catch (e) {
        setError(e instanceof Error ? e.message : '安裝失敗');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, presentResult],
  );

  return {
    agents,
    runtimes,
    error,
    setError,
    busy,
    msg,
    setMsg,
    detailNotes,
    detailFacts,
    refresh,
    register,
    probeKind,
    writeUnit,
    installKind,
  };
}
