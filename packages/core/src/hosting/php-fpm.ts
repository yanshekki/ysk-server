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
}): string {
  const listen =
    opts.listen ?? `/run/php/php${opts.phpVersion}-fpm-${opts.poolName}.sock`;
  const max = opts.pmMaxChildren ?? 5;
  return `; YSK Server PHP-FPM pool for ${opts.poolName}
[${opts.poolName}]
user = ${opts.linuxUser}
group = ${opts.linuxUser}
listen = ${listen}
listen.owner = www-data
listen.group = www-data
pm = ondemand
pm.max_children = ${max}
pm.process_idle_timeout = 10s
chdir = /
php_admin_value[error_log] = /var/log/php${opts.phpVersion}-fpm-${opts.poolName}.log
php_admin_flag[log_errors] = on
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
  });
  writeFileSync(poolPath, content, 'utf8');
  const notes = [`Pool written ${poolPath}`, `PHP ${rt.version}`];
  const written = [poolPath];
  const commandResults: PhpFpmApplyResult['commandResults'] = [];
  let enabled = false;

  const want = Boolean(input.enable);
  const can = want && input.host.executeEnabled() && input.host.isRoot();
  if (want && !can) {
    notes.push('無法啟用 PHP-FPM：需要系統管理員權限');
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
      notes.push(enabled ? `Enabled pool at ${dest}` : 'FPM reload failed');
    } else {
      notes.push(`/etc/php/${rt.version}/fpm not found — install php${rt.version}-fpm`);
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
