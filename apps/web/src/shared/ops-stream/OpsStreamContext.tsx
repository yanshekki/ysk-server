/**
 * Global live-job dock — expandable or minimized bottom-right.
 * Supports several concurrent jobs; one panel expanded at a time.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { InstallStreamLine } from '../components/ui/InstallStreamPanel';
import { toast } from '../stores/toast-store';
import i18n from '../lib/i18n';

export type OpsStreamJobKind =
  | 'install'
  | 'uninstall'
  | 'apply'
  | 'scan'
  | 'deploy'
  | 'runtime';

export type OpsStreamJob = {
  id: string;
  kind: OpsStreamJobKind;
  title: string;
  busy: boolean;
  ok?: boolean;
  cancelled?: boolean;
  lines: InstallStreamLine[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

export type OpsStreamBeginResult = {
  id: string;
  signal: AbortSignal;
};

type OpsStreamCtx = {
  jobs: OpsStreamJob[];
  /** Expanded panel job, or most recent if none chosen. */
  job: OpsStreamJob | null;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  minimized: boolean;
  setMinimized: (v: boolean) => void;
  begin: (input: { kind: OpsStreamJobKind; title: string }) => OpsStreamBeginResult;
  appendLog: (
    id: string,
    line: { stream: 'stdout' | 'stderr' | 'status'; line: string },
  ) => void;
  finish: (
    id: string,
    result: { ok: boolean; error?: string; cancelled?: boolean; toast?: boolean },
  ) => void;
  requestCancel: (id?: string) => void;
  dismiss: (id?: string) => void;
  isBusy: boolean;
  isCancelRequested: boolean;
};

const Ctx = createContext<OpsStreamCtx | null>(null);

export function OpsStreamProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<OpsStreamJob[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const aborts = useRef(new Map<string, AbortController>());

  const begin = useCallback(
    (input: { kind: OpsStreamJobKind; title: string }): OpsStreamBeginResult => {
      const ac = new AbortController();
      const id = `ops-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      aborts.current.set(id, ac);
      setCancelRequested(false);
      const next: OpsStreamJob = {
        id,
        kind: input.kind,
        title: input.title,
        busy: true,
        lines: [],
        startedAt: Date.now(),
      };
      setJobs((prev) => [...prev.filter((j) => j.busy || j.ok === false), next].slice(-6));
      setExpandedId(id);
      setMinimized(false);
      return { id, signal: ac.signal };
    },
    [],
  );

  const appendLog = useCallback(
    (id: string, line: { stream: 'stdout' | 'stderr' | 'status'; line: string }) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id !== id
            ? j
            : {
                ...j,
                lines: [
                  ...j.lines.slice(-1999),
                  { ...line, at: new Date().toISOString() },
                ],
              },
        ),
      );
    },
    [],
  );

  const finish = useCallback(
    (
      id: string,
      result: { ok: boolean; error?: string; cancelled?: boolean; toast?: boolean },
    ) => {
      aborts.current.delete(id);
      setCancelRequested(false);
      let title = '';
      setJobs((prev) =>
        prev.map((j) => {
          if (j.id !== id) return j;
          title = j.title;
          return {
            ...j,
            busy: false,
            ok: result.cancelled ? false : result.ok,
            cancelled: Boolean(result.cancelled),
            error: result.error,
            finishedAt: Date.now(),
          };
        }),
      );
      if (result.toast === false) return;
      if (result.cancelled) {
        toast.warn(i18n.t('softwareLifecycle.cancelledToast'));
      } else if (result.ok) {
        toast.ok(i18n.t('softwareLifecycle.jobDone', { title }));
      } else {
        toast.error(
          result.error?.trim() || i18n.t('softwareLifecycle.jobFailed', { title }),
        );
      }
    },
    [],
  );

  const requestCancel = useCallback((id?: string) => {
    const target = id ?? expandedId;
    if (!target) return;
    const ac = aborts.current.get(target);
    if (!ac || ac.signal.aborted) return;
    setCancelRequested(true);
    setJobs((prev) =>
      prev.map((j) =>
        j.id !== target || !j.busy
          ? j
          : {
              ...j,
              lines: [
                ...j.lines,
                {
                  stream: 'status',
                  line: '— cancel requested —',
                  at: new Date().toISOString(),
                },
              ],
            },
      ),
    );
    try {
      ac.abort();
    } catch {
      /* */
    }
  }, [expandedId]);

  const dismiss = useCallback((id?: string) => {
    const target = id ?? expandedId;
    if (!target) return;
    setJobs((prev) => prev.filter((j) => j.id !== target || j.busy));
    setExpandedId((cur) => (cur === target ? null : cur));
  }, [expandedId]);

  const job = useMemo(() => {
    if (expandedId) return jobs.find((j) => j.id === expandedId) ?? jobs[jobs.length - 1] ?? null;
    return jobs.find((j) => j.busy) ?? jobs[jobs.length - 1] ?? null;
  }, [jobs, expandedId]);

  const value = useMemo(
    () => ({
      jobs,
      job,
      expandedId: job?.id ?? null,
      setExpandedId,
      minimized,
      setMinimized,
      begin,
      appendLog,
      finish,
      requestCancel,
      dismiss,
      isBusy: jobs.some((j) => j.busy),
      isCancelRequested: cancelRequested,
    }),
    [
      jobs,
      job,
      minimized,
      begin,
      appendLog,
      finish,
      requestCancel,
      dismiss,
      cancelRequested,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOpsStream(): OpsStreamCtx {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error('useOpsStream requires OpsStreamProvider');
  }
  return v;
}

export function useOpsStreamOptional(): OpsStreamCtx | null {
  return useContext(Ctx);
}

export function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}
