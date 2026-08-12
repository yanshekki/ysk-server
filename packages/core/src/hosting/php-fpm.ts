import { tl } from 'ysk-server-shared';
/**
 * PHP-FPM pool config generation + optional system install.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { selectPhpRuntime } from './runtime.js';

export function renderPhpFpmPool(opts: {
  poolName: string;
  linuxUser: string;
  phpVersion: string;
  listen?: string;
  pmMaxChildren?: number;
  /** Extra lines e.g. php_admin_value[...] from panel ini */
  adminValueLines?: string[];
}): string {
  const listen =
    opts.listen ?? `/run/php/php${opts.phpVersion}-fpm-${opts.poolName}.sock`;
  const max = opts.pmMaxChildren ?? 5;
  const admin =
    opts.adminValueLines?.length ?
      ['', '; --- YSK panel php.ini (php_admin_*) ---', ...opts.adminValueLines, ''].join('\n')
    : '';
  // Pool MUST run as the project Linux user (isolation). Socket owned by www-data for nginx.
  return `; YSK Server PHP-FPM pool for ${opts.poolName} (project user isolation)
[${opts.poolName}]
user = ${opts.linuxUser}
group = ${opts.linuxUser}
listen = ${listen}
listen.owner = www-data
listen.group = www-data
listen.mode = 0660
pm = ondemand
pm.max_children = ${max}
pm.process_idle_timeout = 10s
chdir = /
php_admin_value[error_log] = /var/log/php${opts.phpVersion}-fpm-${opts.poolName}.log
php_admin_flag[log_errors] = on
${admin}; open_basedir optional — home is enforced by OS user permissions
`;
}

export interface PhpFpmApplyResult {
  ok: boolean;
  poolPath: string;
  written: string[];
  notes: string[];
  enabled: boolean;
  requiresRoot: boolean;
  requiresExecute: boolean;
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
}

/**
 * Write pool conf under dataDir; optionally copy into /etc/php/.../pool.d and reload.
 */
export async function applyPhpFpmPool(input: {
  dataDir: string;
  poolName: string;
  linuxUser: string;
  phpVersion: string;
  host: HostExecutor;
  enable?: boolean;
  pmMaxChildren?: number;
  adminValueLines?: string[];
}): Promise<PhpFpmApplyResult> {
  const rt = selectPhpRuntime(input.phpVersion);
  const dir = join(input.dataDir, 'php', rt.version, 'pool.d');
  mkdirSync(dir, { recursive: true });
  const poolPath = join(dir, `${input.poolName}.conf`);
  const content = renderPhpFpmPool({
    poolName: input.poolName,
    linuxUser: input.linuxUser,
    phpVersion: rt.version,
    pmMaxChildren: input.pmMaxChildren,
    adminValueLines: input.adminValueLines,
  });
  writeFileSync(poolPath, content, 'utf8');
  const notes = [tl('notes.auto.t0146', { v0: (poolPath) }), `PHP ${rt.version}`];
  const written = [poolPath];
  const commandResults: PhpFpmApplyResult['commandResults'] = [];
  let enabled = false;

  const want = Boolean(input.enable);
  const can = want && input.host.executeEnabled() && input.host.isRoot();
  if (want && !can) {
    notes.push(tl('notes.auto.n1152'));
  }
  if (can) {
    const destDir = `/etc/php/${rt.version}/fpm/pool.d`;
    const dest = `${destDir}/ysk-${input.poolName}.conf`;
    // ensure dest dir exists if php installed
    if (existsSync(`/etc/php/${rt.version}/fpm`)) {
      const cp = await input.host.runCommand(['cp', poolPath, dest], { timeoutMs: 10_000 });
      commandResults.push({ argv: ['cp', poolPath, dest], exitCode: cp.exitCode, stderr: cp.stderr });
      const reload = await input.host.runCommand(
        ['systemctl', 'reload', `php${rt.version}-fpm`],
        { timeoutMs: 15_000 },
      );
      commandResults.push({
        argv: ['systemctl', 'reload', `php${rt.version}-fpm`],
        exitCode: reload.exitCode,
        stderr: reload.stderr,
      });
      enabled = cp.exitCode === 0 && reload.exitCode === 0;
      notes.push(enabled ? tl('notes.auto.t0147', { v0: (dest) }) : tl('notes.auto.n0103'));
    } else {
      notes.push(tl('notes.auto.t0148', { v0: (rt.version), v1: (rt.version) }));
    }
  }

  // Fail closed: if enable requested but not executed/enabled, ok=false
  let ok = true;
  if (want && !can) ok = false;
  else if (want && can) ok = enabled;

  return {
    ok,
    poolPath,
    written,
    notes,
    enabled,
    requiresRoot: !input.host.isRoot(),
    requiresExecute: !input.host.executeEnabled(),
    commandResults,
  };
}
