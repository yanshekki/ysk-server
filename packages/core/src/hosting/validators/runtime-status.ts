/**
 * Map compose + RPC probe into a list status.
 * Fresh nodes have no RPC yet — that is starting, not error.
 */
import type { ValidatorRuntimeStatus } from 'ysk-server-shared';

const FATAL_CONTAINER_RE =
  /permission denied|unexpected token|executable file not found|pull access denied|no such file|cannot allocate|fatal|error: command line/i;

/** First compose-log line that explains why a node is not healthy. */
export function pickValidatorContainerHint(lines: string[]): string | null {
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  const fatal = trimmed.find((l) => FATAL_CONTAINER_RE.test(l));
  if (fatal) return fatal.slice(0, 280);
  const last = trimmed[trimmed.length - 1];
  return last ? last.slice(0, 280) : null;
}

export function isTransientValidatorProbeError(err: string | null | undefined): boolean {
  const s = String(err || '').trim();
  if (!s) return false;
  return /rpc unreachable|unhealthy|econnrefused|econnreset|fetch failed|failed to fetch|networkerror|bad rpc|bad status|metrics unreachable|not ready|connection refused|socket hang up|timed? ?out|aborted|eai_again/i.test(
    s,
  );
}

export function deriveValidatorRuntimeStatus(input: {
  running: boolean;
  restarting?: boolean;
  syncProgress?: number | null;
  lastError?: string | null;
}): ValidatorRuntimeStatus {
  if (input.restarting) return 'error';
  if (!input.running) return 'stopped';
  if (input.syncProgress != null && input.syncProgress < 1) return 'syncing';
  if (input.lastError) {
    return isTransientValidatorProbeError(input.lastError) ? 'starting' : 'error';
  }
  return 'running';
}
