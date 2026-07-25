/**
 * AI tasks hook — plan → approve → execute.
 */
import { useCallback, useEffect, useState } from 'react';
import { llmApi, type AiTask, type PlaybookSummary } from './api';

export function useAiTasks() {
  const [prompt, setPrompt] = useState('show system info');
  const [tasks, setTasks] = useState<AiTask[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<AiTask | null>(null);

  const refresh = useCallback(async () => {
    const [t, p] = await Promise.all([llmApi.listTasks(), llmApi.listPlaybooks()]);
    setTasks(t.items);
    setPlaybooks(p.items);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const createTask = useCallback(
    async (text: string) => {
      setBusy(true);
      setError(null);
      try {
        const task = await llmApi.createTask({ prompt: text, enrich: false });
        setSelected(task);
        await refresh();
        return task;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed');
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const approveAndRun = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        await llmApi.approveTask(id);
        const done = await llmApi.executeTask(id);
        setSelected(done);
        await refresh();
        return done;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed');
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const runPlaybook = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = await llmApi.runPlaybook(id);
        setSelected(r.task);
        await refresh();
        return r.task;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed');
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return {
    prompt,
    setPrompt,
    tasks,
    playbooks,
    error,
    busy,
    selected,
    setSelected,
    refresh,
    createTask,
    approveAndRun,
    runPlaybook,
  };
}
