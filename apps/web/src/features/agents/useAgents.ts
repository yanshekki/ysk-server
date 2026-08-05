import { looksLikeBlockedMessage } from '../../shared/lib/operator-messages';
/**
 * Agents feature — fleet + runtimes hooks (panel executes installs).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  agentsApi,
  type FleetAgent,
  type FleetCommand,
  type RuntimeProbe,
} from './api';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';
import { toast } from '../../shared/stores/toast-store';

export function useAgents() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeProbe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [detailNotes, setDetailNotes] = useState<string[]>([]);
  const [detailFacts, setDetailFacts] = useState<Array<{ label: string; value: string }>>([]);
  const [commands, setCommands] = useState<FleetCommand[]>([]);

  const refresh = useCallback(async () => {
    const [fleet, rts] = await Promise.all([agentsApi.listFleet(), agentsApi.listRuntimes()]);
    setAgents(fleet.items);
    setRuntimes(rts.items);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const presentResult = useCallback(
    (r: Record<string, unknown>, fallbackMsg: string) => {
      const notes = sanitizeOperatorNotes(
        Array.isArray(r.notes) ? r.notes.map(String) : r.message ? [String(r.message)] : [],
      );
      setDetailNotes(notes);
      const FACT_LABEL_KEYS: Record<string, string> = {
        kind: 'agents.fact.kind',
        name: 'agents.fact.name',
        status: 'agents.fact.status',
        unitActive: 'agents.fact.unitActive',
        unitName: 'agents.fact.unitName',
        pathExists: 'agents.fact.pathExists',
        installPath: 'agents.fact.installPath',
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
        const labelKey = FACT_LABEL_KEYS[k];
        facts.push({ label: labelKey ? t(labelKey) : k, value: String(v) });
      }
      setDetailFacts(facts.slice(0, 12));
      // L3: match backend Chinese / mixed permission notes until error codes exist
      const blocked = Boolean(
        r.ok === false &&
          (r.requiresExecute || notes.some((n) => looksLikeBlockedMessage(n))),
      );
      const text = blocked ? notes[0] ?? t('agents.installBlocked') : fallbackMsg;
      setMsg(null);
      if (blocked) toast.warn(text);
      else toast.ok(text);
    },
    [t],
  );

  const register = useCallback(
    async (agentId: string, group = 'default') => {
      setBusy(true);
      setError(null);
      try {
        await agentsApi.register({ agentId, group, meta: { source: 'panel' } });
        await refresh();
        setMsg(null);
        toast.ok(t('agents.registeredMsg', { id: agentId }));
      } catch (e) {
        const m = e instanceof Error ? e.message : t('agents.registerFailed');
        setError(null);
        toast.error(m);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, t],
  );

  const removeAgent = useCallback(
    async (sessionId: string) => {
      setBusy(true);
      setError(null);
      try {
        await agentsApi.remove(sessionId);
        setCommands([]);
        await refresh();
        setMsg(null);
        toast.ok(t('agents.removedFleet'));
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.deleteFailed');
        setError(null);
        toast.error(m);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, t],
  );

  const enqueueCommand = useCallback(
    async (sessionId: string, payload: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const cmd = await agentsApi.enqueue(sessionId, payload);
        const hist = await agentsApi.listCommands(sessionId);
        setCommands(hist.items);
        setMsg(null);
        toast.ok(t('agents.enqueuedMsg', { id: cmd.id.slice(0, 8) }));
        return cmd;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('agents.enqueueFailed');
        setError(null);
        toast.error(m);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const loadCommands = useCallback(
    async (sessionId: string) => {
      setBusy(true);
      setError(null);
      try {
        const hist = await agentsApi.listCommands(sessionId);
        setCommands(hist.items);
        return hist.items;
      } catch (e) {
        setError(e instanceof Error ? e.message : t('agents.loadCommandsFailed'));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const probeKind = useCallback(
    async (kind: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = await agentsApi.probe(kind);
        presentResult(
          (r.runtime as unknown as Record<string, unknown>) ??
            (r as unknown as Record<string, unknown>),
          t('agents.probedMsg', { kind }),
        );
        await refresh();
      } catch (e) {
        const m = e instanceof Error ? e.message : t('agents.probeFailed');
        setError(null);
        toast.error(m);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, presentResult, t],
  );

  const writeUnit = useCallback(
    async (kind: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = (await agentsApi.writeUnit(kind)) as Record<string, unknown>;
        presentResult(r, t('agents.wroteUnitMsg', { kind }));
      } catch (e) {
        const m = e instanceof Error ? e.message : t('agents.writeFailed');
        setError(null);
        toast.error(m);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [presentResult, t],
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
          r.ok ? t('agents.installedMsg', { kind }) : t('agents.installIncomplete'),
        );
        await refresh();
        return r;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.installFailed');
        setError(null);
        toast.error(m);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, presentResult, t],
  );

  return {
    agents,
    runtimes,
    commands,
    setCommands,
    error,
    setError,
    busy,
    msg,
    setMsg,
    detailNotes,
    detailFacts,
    refresh,
    register,
    removeAgent,
    enqueueCommand,
    loadCommands,
    probeKind,
    writeUnit,
    installKind,
  };
}
