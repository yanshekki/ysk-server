/**
 * Single source of truth for **shell** binary probes (remote scripts, bash -c fragments).
 * Must stay aligned with resolve-bin.ts PROBE_PATH.
 *
 * TypeScript host probes use resolveBin/binPresent; generated bash uses these helpers only.
 */

import { PROBE_PATH } from './resolve-bin.js';

/** export PATH=… used by every shell probe fragment */
export function shellProbePathExport(): string {
  return `export PATH="${PROBE_PATH}:\${HOME:-}/.cargo/bin:\${PATH:-}"`;
}

/**
 * True if bin is on probe PATH (exit 0 of the fragment when used with `if …; then`).
 * Example: `if ${shellBinExists('nginx')}; then …`
 */
export function shellBinExists(bin: string): string {
  const safe = sanitizeBin(bin);
  return `( ${shellProbePathExport()}; command -v ${safe} >/dev/null 2>&1 )`;
}

/**
 * Echo absolute path or empty. For capture: `BIN=$(${shellResolveBin('node')})`
 */
export function shellResolveBin(bin: string): string {
  const safe = sanitizeBin(bin);
  return `( ${shellProbePathExport()}; command -v ${safe} 2>/dev/null || true )`;
}

/** `if ! has; then fail` style message */
export function shellRequireBin(bin: string, failEcho: string): string {
  return `if ! ${shellBinExists(bin)}; then echo ${JSON.stringify(failEcho)}; exit 2; fi`;
}

/** Install-if-missing apt pattern (product apply scripts) */
export function shellEnsureAptPackage(bin: string, packages: string): string {
  return `if ! ${shellBinExists(bin)}; then export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y ${packages}; fi`;
}

function sanitizeBin(bin: string): string {
  if (!bin || /[^a-zA-Z0-9._+-]/.test(bin)) {
    throw new Error(`invalid bin name for shell probe: ${bin}`);
  }
  return bin;
}
