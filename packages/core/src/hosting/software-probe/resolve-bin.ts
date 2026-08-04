/**
 * Single PATH / absolute-path binary resolution for host probes.
 * Do not re-implement command -v elsewhere for product software.
 */

import type { HostExecutor } from '../../host/executor.js';

/** Standard PATH used for all product software probes */
export const PROBE_PATH =
  '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/cargo/bin';

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
 * Resolve a bare binary name to an absolute path if present on the host.
 * Returns empty string when missing.
 */
export async function resolveBin(host: HostExecutor, bin: string): Promise<string> {
  if (!bin || /[^a-zA-Z0-9._+-]/.test(bin)) return '';
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `export PATH="${PROBE_PATH}:\${HOME}/.cargo/bin:\${PATH:-}"; command -v ${bin} 2>/dev/null || true`,
    ],
    { timeoutMs: 5_000 },
  );
  const fromPath = r.stdout.trim().split('\n')[0]?.trim() ?? '';
  if (fromPath) return fromPath;
  for (const p of absoluteBinCandidates(bin)) {
    if (host.pathExists(p)) return p;
  }
  return '';
}

/** Whether a bare binary name exists (product-wide standard). */
export async function binPresent(host: HostExecutor, bin: string): Promise<boolean> {
  return (await resolveBin(host, bin)).length > 0;
}

export async function unitIsActive(host: HostExecutor, unit: string): Promise<string | undefined> {
  if (!host.pathExists('/bin/systemctl') && !host.pathExists('/usr/bin/systemctl')) {
    return undefined;
  }
  const r = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 5_000 });
  return (r.stdout || r.stderr || '').trim().split('\n')[0] || undefined;
}

export async function unitIsEnabled(host: HostExecutor, unit: string): Promise<string | undefined> {
  if (!host.pathExists('/bin/systemctl') && !host.pathExists('/usr/bin/systemctl')) {
    return undefined;
  }
  const r = await host.runCommand(['systemctl', 'is-enabled', unit], { timeoutMs: 5_000 });
  return (r.stdout || r.stderr || '').trim().split('\n')[0] || undefined;
}
