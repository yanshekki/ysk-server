/**
 * Host long-running jobs: single-flight mutex for apt/runtime installs + shared hooks.
 * Prevents parallel apt-get / dpkg races (Updates + PHP install at once).
 */

export type HostJobLog = {
  stream: 'stdout' | 'stderr';
  line: string;
};

export type HostJobHooks = {
  onLog?: (ev: HostJobLog) => void;
  abortSignal?: AbortSignal;
};

/** Tail of the mutating-job chain (serialized). */
let mutatingTail: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` exclusively among other withHostMutatingJob callers.
 * Concurrent calls wait their turn (FIFO via promise chain).
 */
export async function withHostMutatingJob<T>(fn: () => Promise<T>): Promise<T> {
  const prev = mutatingTail;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mutatingTail = prev.then(() => gate, () => gate);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Test-only: reset chain (do not use in production). */
export function __resetHostMutatingJobForTests(): void {
  mutatingTail = Promise.resolve();
}

/**
 * Map HostExecutor onChunk → HostJob onLog (line-oriented already from executor).
 */
export function hostJobOnChunk(
  onLog?: (ev: HostJobLog) => void,
): ((c: { stream: 'stdout' | 'stderr'; text: string }) => void) | undefined {
  if (!onLog) return undefined;
  return (c) => onLog({ stream: c.stream, line: c.text });
}
