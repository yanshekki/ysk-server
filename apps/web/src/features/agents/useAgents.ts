/**
 * Agents feature — fleet + runtimes hooks.
 */
import { useCallback, useEffect, useState } from 'react';
import { agentsApi, type FleetAgent, type RuntimeProbe } from './api';

export function useAgents() {
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeProbe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const refresh = useCallback(async () => {
    const [fleet, rts] = await Promise.all([agentsApi.listFleet(), agentsApi.listRuntimes()]);
    setAgents(fleet.items);
    setRuntimes(rts.items);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const register = useCallback(
    async (agentId: string, group = 'default') => {
      setBusy(true);
      setError(null);
      try {
        await agentsApi.register({ agentId, group });
        await refresh();
        setMsg(`Registered ${agentId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'register failed');
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
        setDetail(r.runtime as unknown as Record<string, unknown>);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'probe failed');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const writeUnit = useCallback(async (kind: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await agentsApi.writeUnit(kind);
      setDetail(r);
      setMsg(`Unit written for ${kind}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unit failed');
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const installKind = useCallback(
    async (kind: string, execute = false) => {
      setBusy(true);
      setError(null);
      try {
        const r = await agentsApi.install(kind, execute);
        setDetail(r);
        setMsg(
          r.ok
            ? `Install ${execute ? 'applied' : 'artifacts'} for ${kind}`
            : `Install incomplete — set YSK_EXECUTE=1 for real install`,
        );
        await refresh();
        return r;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'install failed');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const showPlan = useCallback(async (kind: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await agentsApi.plan(kind);
      setDetail(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'plan failed');
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    agents,
    runtimes,
    error,
    setError,
    busy,
    msg,
    setMsg,
    detail,
    refresh,
    register,
    probeKind,
    writeUnit,
    installKind,
    showPlan,
  };
}
