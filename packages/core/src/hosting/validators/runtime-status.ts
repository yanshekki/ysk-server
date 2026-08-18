/**
 * Map compose + RPC probe into a list status.
 * Fresh nodes have no RPC yet — that is starting, not error.
 */
import type { ValidatorRuntimeStatus } from 'ysk-server-shared';

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
