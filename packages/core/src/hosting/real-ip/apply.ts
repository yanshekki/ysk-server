/**
 * Write Apache RemoteIP + managed nginx real-ip include; optional system apply.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import { renderApacheRemoteIpConf, renderNginxRealIpBlock } from './render.js';
import { loadRealIpConfig } from './store.js';
import type { RealIpHostConfig, RealIpProviderId } from './types.js';

export async function applyRealIpArtifacts(input: {
  dataDir: string;
  host?: HostExecutor;
  /** Also enable Apache remoteip module on system */
  enableApacheRemoteIp?: boolean;
}): Promise<{
  ok: boolean;
  written: string[];
  notes: string[];
  config: RealIpHostConfig;
}> {
  const notes: string[] = [];
  const written: string[] = [];
  const config = loadRealIpConfig(input.dataDir);

  // Per-provider nginx snippets under dataDir
  const nginxInc = join(input.dataDir, 'nginx', 'real-ip');
  mkdirSync(nginxInc, { recursive: true });
  for (const id of [
    'none',
    'cloudflare',
    'fastly',
    'bunny',
    'cloudfront',
    'azure_frontdoor',
    'gcore',
    'custom',
  ] as RealIpProviderId[]) {
    const body = renderNginxRealIpBlock({ provider: id, host: config });
    const path = join(nginxInc, `${id}.conf`);
    writeFileSync(path, body ? body + '\n' : '# real_ip disabled\n', 'utf8');
    written.push(path);
  }
  // Active default
  const active = renderNginxRealIpBlock({
    provider: config.defaultProvider,
    host: config,
  });
  const activePath = join(nginxInc, 'active.conf');
  writeFileSync(activePath, active ? active + '\n' : '# real_ip disabled\n', 'utf8');
  written.push(activePath);
  notes.push(`nginx real-ip snippets → ${nginxInc}`);

  // Apache RemoteIP for PHP backend
  const apacheDir = join(input.dataDir, 'apache', 'conf-available');
  mkdirSync(apacheDir, { recursive: true });
  const apachePath = join(apacheDir, 'ysk-remoteip.conf');
  writeFileSync(apachePath, renderApacheRemoteIpConf(), 'utf8');
  written.push(apachePath);
  notes.push(`apache RemoteIP → ${apachePath}`);

  if (input.enableApacheRemoteIp && input.host?.executeEnabled() && input.host.isRoot()) {
    const dest = '/etc/apache2/conf-available/ysk-remoteip.conf';
    const cp = await input.host.runCommand(['cp', apachePath, dest], { timeoutMs: 10_000 });
    notes.push(`cp RemoteIP exit=${cp.exitCode}`);
    await input.host.runCommand(['a2enmod', 'remoteip'], { timeoutMs: 10_000 });
    await input.host.runCommand(['a2enconf', 'ysk-remoteip'], { timeoutMs: 10_000 });
    const rel = await input.host.runCommand(['systemctl', 'reload', 'apache2'], {
      timeoutMs: 15_000,
    });
    notes.push(`apache2 reload exit=${rel.exitCode}`);
  } else if (input.enableApacheRemoteIp) {
    notes.push('Apache RemoteIP system install skipped (need root + YSK_EXECUTE)');
  }

  return { ok: true, written, notes, config };
}
