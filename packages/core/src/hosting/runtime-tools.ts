import { tl } from '@ysk-server/shared';
/**
 * Runtime tooling probes: composer, wp-cli, php modules.
 */

import type { HostExecutor } from '../host/executor.js';

export async function probeRuntimeTools(host: HostExecutor): Promise<{
  php?: { version?: string; modules: string[] };
  composer?: { available: boolean; version?: string };
  wpCli?: { available: boolean; version?: string };
  notes: string[];
}> {
  const notes: string[] = [];
  let php: { version?: string; modules: string[] } | undefined;
  let composer: { available: boolean; version?: string } | undefined;
  let wpCli: { available: boolean; version?: string } | undefined;

  const phpV = await host.runCommand(['bash', '-c', 'php -v 2>/dev/null | head -1 || true'], {
    timeoutMs: 5_000,
  });
  if (phpV.stdout.trim()) {
    const mods = await host.runCommand(['bash', '-c', 'php -m 2>/dev/null | head -80 || true'], {
      timeoutMs: 5_000,
    });
    php = {
      version: phpV.stdout.trim().split('\n')[0],
      modules: mods.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('[')),
    };
  } else {
    notes.push(tl('notes.auto.n0376'));
  }

  const c = await host.runCommand(['bash', '-c', 'composer -V 2>/dev/null || true'], {
    timeoutMs: 5_000,
  });
  composer = {
    available: Boolean(c.stdout.trim()),
    version: c.stdout.trim() || undefined,
  };

  const w = await host.runCommand(['bash', '-c', 'wp --info 2>/dev/null | head -3 || true'], {
    timeoutMs: 5_000,
  });
  wpCli = {
    available: Boolean(w.stdout.trim()),
    version: w.stdout.trim().split('\n')[0] || undefined,
  };

  return { php, composer, wpCli, notes };
}
