/**
 * Global install/uninstall stream dock — expandable or minimized bottom-right.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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
  lines: InstallStreamLine[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

type OpsStreamCtx = {
  job: OpsStreamJob | null;
  minimized: boolean;
  setMinimized: (v: boolean) => void;
  begin: (input: {
    kind: OpsStreamJobKind;
    title: string;
  }) => string;
  appendLog: (
    id: string,
    line: { stream: 'stdout' | 'stderr' | 'status'; line: string },
  ) => void;
  finish: (id: string, result: { ok: boolean; error?: string }) => void;
  dismiss: () => void;
  isBusy: boolean;
};

const Ctx = createContext<OpsStreamCtx | null>(null);

export function OpsStreamProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<OpsStreamJob | null>(null);
  const [minimized, setMinimized] = useState(false);

  const begin = useCallback(
    (input: { kind: OpsStreamJobKind; title: string }) => {
      const id = `ops-${Date.now()}`;
      setJob({
        id,
        kind: input.kind,
        title: input.title,
        busy: true,
        lines: [],
        startedAt: Date.now(),
      });
      setMinimized(false);
      return id;
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
    (id: string, result: { ok: boolean; error?: string }) => {
      setJob((prev) => {
        if (!prev || prev.id !== id) return prev;
        return {
          ...prev,
          busy: false,
          ok: result.ok,
          error: result.error,
          finishedAt: Date.now(),
        };
      });
    },
    [],
  );

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
      dismiss,
      isBusy: Boolean(job?.busy),
    }),
    [job, minimized, begin, appendLog, finish, dismiss],
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
