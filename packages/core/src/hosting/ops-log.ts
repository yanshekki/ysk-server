/**
 * Live log hook for long host jobs (SSE / OpsStream).
 */
export type OpsLogEvent = { stream: 'stdout' | 'stderr' | 'status'; line: string };
export type OpsLogFn = (ev: OpsLogEvent) => void;

export function runOpts(input: {
  execute?: boolean;
  timeoutMs?: number;
  onLog?: OpsLogFn;
  signal?: AbortSignal;
}): {
  timeoutMs?: number;
  dryRun?: boolean;
  signal?: AbortSignal;
  onChunk?: (c: { stream: 'stdout' | 'stderr'; text: string }) => void;
} {
  return {
    timeoutMs: input.timeoutMs,
    dryRun: input.execute === false,
    signal: input.signal,
    onChunk: input.onLog
      ? (c) => {
          const line = c.text.replace(/\r/g, '').trimEnd();
          if (line) input.onLog!({ stream: c.stream, line });
        }
      : undefined,
  };
}
