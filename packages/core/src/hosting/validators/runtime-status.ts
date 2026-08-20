/**
 * Map compose + RPC probe into a list status.
 * Fresh nodes have no RPC yet — that is rpc_wait, not error.
 */
import type { ValidatorRuntimeStatus } from 'ysk-server-shared';

const FATAL_CONTAINER_RE =
  /permission denied|unexpected token|executable file not found|pull access denied|no such file|cannot allocate|fatal|error: command line|address already in use|failed to bind|not found|dns error|no address associated with hostname|temporary failure in name resolution|initgenesis|nil pointer|invalid memory address|invalidssz|checkpoint state|failed to start beacon node|failed to connect to bootstrap|not connected to a minimum of 1 peer|not connected to enough stake/i;

const OOM_RE = /\bkilled\b|out of memory|\booms?k?ill|cannot allocate memory|exit \(137\)/i;
const NOFILE_RE = /too many open files|ensure_max_open_files_limit|RLIMIT_NOFILE/i;

/** First compose-log line that explains why a node is not healthy. */
export function pickValidatorContainerHint(lines: string[]): string | null {
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  const oom = trimmed.find((l) => OOM_RE.test(l));
  if (oom) return oom.slice(0, 280);
  const nofile = trimmed.find((l) => NOFILE_RE.test(l));
  if (nofile) return nofile.slice(0, 280);
  const fatal = trimmed.find((l) => FATAL_CONTAINER_RE.test(l));
  if (fatal) return fatal.slice(0, 280);
  const last = trimmed[trimmed.length - 1];
  return last ? last.slice(0, 280) : null;
}

export function isValidatorOomHint(err: string | null | undefined): boolean {
  return OOM_RE.test(String(err || ''));
}

export function isValidatorNofileHint(err: string | null | undefined): boolean {
  return NOFILE_RE.test(String(err || ''));
}

export function isTransientValidatorProbeError(err: string | null | undefined): boolean {
  const s = String(err || '').trim();
  if (!s) return false;
  return /rpc unreachable|unhealthy|econnrefused|econnreset|fetch failed|failed to fetch|networkerror|bad rpc|bad status|metrics unreachable|not ready|connection refused|socket hang up|timed? ?out|aborted|eai_again|unexpected end of json|unexpected token.*json|not valid json|unauthorized|forbidden|\b401\b|\b403\b|rpc auth|empty (rpc )?body|0 peers|not connected to a minimum of 1 peer|failed to connect to bootstrap/i.test(
    s,
  );
}

export function deriveValidatorRuntimeStatus(input: {
  running: boolean;
  restarting?: boolean;
  created?: boolean;
  missing?: boolean;
  syncProgress?: number | null;
  lastError?: string | null;
}): ValidatorRuntimeStatus {
  if (input.restarting) return 'error';
  if (input.created) return 'created';
  if (input.missing) return 'missing';
  if (!input.running) return 'stopped';
  if (input.syncProgress != null && input.syncProgress < 1) return 'syncing';
  if (input.lastError) {
    return isTransientValidatorProbeError(input.lastError) ? 'rpc_wait' : 'error';
  }
  return 'running';
}
