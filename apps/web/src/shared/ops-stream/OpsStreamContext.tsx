/**
 * Global install/uninstall stream dock — expandable or minimized bottom-right.
 * Supports soft cancel via AbortController (client disconnect; server may finish current step).
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

export type OpsStreamJobKind = 'install' | 'uninstall';

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
  job: OpsStreamJob | null;
  minimized: boolean;
  setMinimized: (v: boolean) => void;
  begin: (input: {
    kind: OpsStreamJobKind;
    title: string;
  }) => OpsStreamBeginResult;
  appendLog: (
    id: string,
    line: { stream: 'stdout' | 'stderr' | 'status'; line: string },
  ) => void;
  finish: (
    id: string,
    result: { ok: boolean; error?: string; cancelled?: boolean },
  ) => void;
  /** Soft-cancel: abort client stream; log status line. */
  requestCancel: () => void;
  dismiss: () => void;
  isBusy: boolean;
  isCancelRequested: boolean;
};

const Ctx = createContext<OpsStreamCtx | null>(null);

export function OpsStreamProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<OpsStreamJob | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const begin = useCallback(
    (input: { kind: OpsStreamJobKind; title: string }): OpsStreamBeginResult => {
      // Abort any previous stray controller
      try {
        abortRef.current?.abort();
      } catch {
        /* */
      }
      const ac = new AbortController();
      abortRef.current = ac;
      const id = `ops-${Date.now()}`;
      setCancelRequested(false);
      setJob({
        id,
        kind: input.kind,
        title: input.title,
        busy: true,
        lines: [],
        startedAt: Date.now(),
      });
      setMinimized(false);
      return { id, signal: ac.signal };
    },
    [],
  );

  const appendLog = useCallback(
    (id: string, line: { stream: 'stdout' | 'stderr' | 'status'; line: string }) => {
      setJob((prev) => {
        if (!prev || prev.id !== id) return prev;
        return {
          ...prev,
          lines: [
            ...prev.lines.slice(-1999),
            { ...line, at: new Date().toISOString() },
          ],
        };
      });
    },
    [],
  );

  const finish = useCallback(
    (
      id: string,
      result: { ok: boolean; error?: string; cancelled?: boolean },
    ) => {
      if (abortRef.current) {
        abortRef.current = null;
      }
      setCancelRequested(false);
      setJob((prev) => {
        if (!prev || prev.id !== id) return prev;
        return {
          ...prev,
          busy: false,
          ok: result.cancelled ? false : result.ok,
          cancelled: Boolean(result.cancelled),
          error: result.error,
          finishedAt: Date.now(),
        };
      });
    },
    [],
  );

  const requestCancel = useCallback(() => {
    const ac = abortRef.current;
    if (!ac || ac.signal.aborted) return;
    setCancelRequested(true);
    setJob((prev) => {
      if (!prev?.busy) return prev;
      return {
        ...prev,
        lines: [
          ...prev.lines,
          {
            stream: 'status',
            line: '— cancel requested —',
            at: new Date().toISOString(),
          },
        ],
      };
    });
    try {
      ac.abort();
    } catch {
      /* */
    }
  }, []);

  const dismiss = useCallback(() => {
    setJob((prev) => (prev?.busy ? prev : null));
  }, []);

  const value = useMemo(
    () => ({
      job,
      minimized,
      setMinimized,
      begin,
      appendLog,
      finish,
      requestCancel,
      dismiss,
      isBusy: Boolean(job?.busy),
      isCancelRequested: cancelRequested,
    }),
    [
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

/** Safe optional hook when provider may be missing in tests */
export function useOpsStreamOptional(): OpsStreamCtx | null {
  return useContext(Ctx);
}

export function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}
