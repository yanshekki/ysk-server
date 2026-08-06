/**
 * Single PATH / absolute-path binary resolution for host probes.
 * Do not re-implement command -v elsewhere for product software.
 */

import type { HostExecutor } from '../../host/executor.js';

/** Standard PATH used for all product software probes */
export const PROBE_PATH =
  '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/cargo/bin';

/**
 * Bash snippet: prepend YSK toolchain bins (node/go/bun/python) so probes find
 * installs under /usr/local/ysk even when not symlinked into /usr/local/bin.
 *
 * Safe under `set -u` / `set -e` (used inside install.sh via shellBinExists).
 * Avoids `for x in empty-glob` unbound-variable failures on some bash + nullglob.
 */
export function shellPrependYskToolchainPath(): string {
  // Build globs without */ inside block comments (esbuild).
  const nodeGlob = '/usr/local/ysk/node/' + '*/bin';
  const goGlob = '/usr/local/ysk/go/' + '*/bin';
  const pyGlob = '/usr/local/ysk/python/' + '*/bin';
  const bunBin = '/usr/local/ysk/bun/bin';
  return [
    'export PATH="' + PROBE_PATH + ':${HOME:-}/.cargo/bin:${PATH:-}"',
    // ls -d: no match → empty + exit 1; || true keeps set -e happy
    `_ysk_extra="$(ls -d ${nodeGlob} ${goGlob} ${pyGlob} ${bunBin} 2>/dev/null | tr '\\n' ':' | sed 's/:$//')" || true`,
    'if [ -n "${_ysk_extra:-}" ]; then export PATH="${_ysk_extra}:$PATH"; fi',
    'unset _ysk_extra 2>/dev/null || true',
  ].join('\n');
}

export function absoluteBinCandidates(bin: string): string[] {
  return [
    `/usr/local/sbin/${bin}`,
    `/usr/local/bin/${bin}`,
    `/usr/sbin/${bin}`,
    `/usr/bin/${bin}`,
    `/sbin/${bin}`,
    `/bin/${bin}`,
    `/usr/local/cargo/bin/${bin}`,
  ];
}

/**
 * Debian/Ubuntu PostgreSQL ships versioned binaries outside PATH, e.g.
 * /usr/lib/postgresql/16/bin/postgres — not on /usr/bin.
 */
const PG_VERSIONED_BINS = new Set([
  'postgres',
  'pg_ctl',
  'initdb',
  'pg_isready',
  'pg_dump',
  'pg_restore',
  'createdb',
  'dropdb',
  'createuser',
  'dropuser',
]);

async function resolvePostgresVersionedBin(host: HostExecutor, bin: string): Promise<string> {
  if (!PG_VERSIONED_BINS.has(bin)) return '';
  try {
    const r = await host.runCommand(
      [
        'bash',
        '-c',
        // Prefer highest version; paths are fixed under /usr/lib/postgresql
        `ls -1 /usr/lib/postgresql/*/bin/${bin} 2>/dev/null | sort -V | tail -n 1 || true`,
      ],
      { timeoutMs: 5_000 },
    );
    const p = r.stdout.trim().split('\n').filter(Boolean).pop()?.trim() ?? '';
    if (p.startsWith('/') && host.pathExists(p)) return p;
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * Resolve a bare binary name to an absolute path if present on the host.
 * Returns empty string when missing.
 */
export async function resolveBin(host: HostExecutor, bin: string): Promise<string> {
  if (!bin || /[^a-zA-Z0-9._+-]/.test(bin)) return '';
  try {
    const r = await host.runCommand(
      [
        'bash',
        '-c',
        `${shellPrependYskToolchainPath()}\ncommand -v ${bin} 2>/dev/null || true`,
      ],
      { timeoutMs: 5_000 },
    );
    const fromPath = r.stdout.trim().split('\n')[0]?.trim() ?? '';
    // Reject non-path noise (legacy mocks returned "yes"/"no")
    if (fromPath.startsWith('/') || fromPath.includes('/')) return fromPath;
  } catch {
    /* host error → missing */
  }
  for (const p of absoluteBinCandidates(bin)) {
    try {
      if (host.pathExists(p)) return p;
    } catch {
      /* ignore */
    }
  }
  const pg = await resolvePostgresVersionedBin(host, bin);
  if (pg) return pg;
  return '';
}

/** Whether a bare binary name exists (product-wide standard). */
export async function binPresent(host: HostExecutor, bin: string): Promise<boolean> {
  return (await resolveBin(host, bin)).length > 0;
}

export async function unitIsActive(host: HostExecutor, unit: string): Promise<string | undefined> {
  try {
    if (!host.pathExists('/bin/systemctl') && !host.pathExists('/usr/bin/systemctl')) {
      return undefined;
    }
    const r = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 5_000 });
    return (r.stdout || r.stderr || '').trim().split('\n')[0] || undefined;
  } catch {
    return undefined;
  }
}

export async function unitIsEnabled(host: HostExecutor, unit: string): Promise<string | undefined> {
  try {
    if (!host.pathExists('/bin/systemctl') && !host.pathExists('/usr/bin/systemctl')) {
      return undefined;
    }
    const r = await host.runCommand(['systemctl', 'is-enabled', unit], { timeoutMs: 5_000 });
    return (r.stdout || r.stderr || '').trim().split('\n')[0] || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Poll systemctl is-active until active (or timeout).
 * Treats `activating` as transient; `failed` aborts early.
 */
export async function waitUnitActive(
  host: HostExecutor,
  unit: string,
  opts?: { timeoutMs?: number; pollMs?: number },
): Promise<{ ok: boolean; active: string; notes: string[] }> {
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const pollMs = opts?.pollMs ?? 1_500;
  const start = Date.now();
  let last = 'unknown';
  while (Date.now() - start < timeoutMs) {
    last = (await unitIsActive(host, unit)) ?? 'unknown';
    if (last === 'active') {
      return { ok: true, active: last, notes: [] };
    }
    if (last === 'failed') {
      return {
        ok: false,
        active: last,
        notes: [`unit ${unit} failed while waiting for active`],
      };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return {
    ok: last === 'active',
    active: last,
    notes:
      last === 'active'
        ? []
        : [`unit ${unit} still ${last} after ${timeoutMs}ms (expected active)`],
  };
}
