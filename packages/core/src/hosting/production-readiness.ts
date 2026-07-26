/**
 * Spec-aligned production readiness probe — honest report, never over-claim.
 * Maps to AI-Secure-Linux-Server-Manager-Spec phases / hosting gates.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { listSupportedRuntimes } from './runtime.js';
import { probeRuntimes } from './runtime-probe.js';
import { probePowerDns } from './powerdns-apply.js';
import { probePm2 } from './pm2-apply.js';

export type ReadinessLevel = 'ready' | 'degraded' | 'missing' | 'unknown';

export interface ReadinessItem {
  id: string;
  category: string;
  title: string;
  level: ReadinessLevel;
  detail: string;
  /** Spec section reference */
  spec?: string;
  fixHint?: string;
}

export interface ProductionReadinessReport {
  product: string;
  generatedAt: string;
  mode: 'production_capable' | 'degraded';
  executeEnabled: boolean;
  isRoot: boolean;
  score: { ready: number; degraded: number; missing: number; total: number };
  items: ReadinessItem[];
  summary: string[];
  /** Honest: false until production_capable and critical hosting gates ready */
  productionReady: boolean;
}

async function hasCmd(host: HostExecutor, bin: string): Promise<boolean> {
  const r = await host.runCommand(['bash', '-c', `command -v ${bin} || true`], {
    timeoutMs: 5_000,
  });
  return Boolean(r.stdout.trim());
}

/**
 * Build full readiness report for operators / install gate.
 */
export async function assessProductionReadiness(input: {
  dataDir: string;
  host: HostExecutor;
  product?: string;
  version?: string;
}): Promise<ProductionReadinessReport> {
  const items: ReadinessItem[] = [];
  const push = (item: ReadinessItem) => items.push(item);
  const host = input.host;
  const executeEnabled = host.executeEnabled();
  const isRoot = host.isRoot();
  const mode = executeEnabled && isRoot ? 'production_capable' : 'degraded';

  push({
    id: 'control-plane',
    category: 'core',
    title: 'Control plane dataDir',
    level: existsSync(input.dataDir) ? 'ready' : 'missing',
    detail: input.dataDir,
    spec: '§2.3',
    fixHint: 'Run ysk-server setup --data-dir PATH',
  });

  push({
    id: 'execute-policy',
    category: 'security',
    title: 'YSK_EXECUTE host mutations',
    level: executeEnabled ? 'ready' : 'degraded',
    detail: executeEnabled
      ? 'EXECUTE enabled — host mutations allowed'
      : 'EXECUTE off — configs written under dataDir only (fail-closed)',
    spec: '§3.2',
    fixHint: 'export YSK_EXECUTE=1 (and run as root for system paths)',
  });

  push({
    id: 'root',
    category: 'security',
    title: 'Root for system paths',
    level: isRoot ? 'ready' : 'degraded',
    detail: isRoot ? 'Running as root' : 'Non-root — useradd/systemd/nginx system paths limited',
    spec: '§4.1',
    fixHint: 'sudo -E ysk-server serve …',
  });

  const bins: Array<{ id: string; bin: string; title: string; spec: string; critical?: boolean }> =
    [
      { id: 'bin-nginx', bin: 'nginx', title: 'nginx binary', spec: '§4.7', critical: true },
      { id: 'bin-node', bin: 'node', title: 'node binary', spec: '§4.2', critical: true },
      { id: 'bin-git', bin: 'git', title: 'git binary', spec: '§4.2' },
      { id: 'bin-php', bin: 'php', title: 'php binary', spec: '§4.3' },
      { id: 'bin-mysql', bin: 'mysql', title: 'mysql client', spec: '§4.4' },
      { id: 'bin-psql', bin: 'psql', title: 'psql client', spec: '§4.4' },
      { id: 'bin-redis', bin: 'redis-cli', title: 'redis-cli', spec: '§4.4' },
      { id: 'bin-openssl', bin: 'openssl', title: 'openssl (mailbox hashes)', spec: '§5' },
      { id: 'bin-postfix', bin: 'postfix', title: 'postfix', spec: '§5' },
      { id: 'bin-dovecot', bin: 'dovecot', title: 'dovecot', spec: '§5' },
      { id: 'bin-certbot', bin: 'certbot', title: 'certbot', spec: '§4.6' },
      { id: 'bin-ufw', bin: 'ufw', title: 'ufw', spec: '§4.9' },
      { id: 'bin-fail2ban', bin: 'fail2ban-client', title: 'fail2ban', spec: '§4.9' },
      { id: 'bin-pdnsutil', bin: 'pdnsutil', title: 'pdnsutil (PowerDNS)', spec: '§4.8' },
    ];

  for (const b of bins) {
    const ok = await hasCmd(host, b.bin);
    push({
      id: b.id,
      category: 'binaries',
      title: b.title,
      level: ok ? 'ready' : b.critical ? 'missing' : 'degraded',
      detail: ok ? `${b.bin} on PATH` : `${b.bin} not found`,
      spec: b.spec,
      fixHint: ok ? undefined : `apt install / hosting runtime-install for ${b.bin}`,
    });
  }

  const runtimes = await probeRuntimes(host);
  const nodeReady = runtimes.node.filter((n) => n.available).map((n) => n.version);
  const phpReady = runtimes.php.filter((p) => p.available).map((p) => p.version);
  push({
    id: 'runtimes-node',
    category: 'hosting',
    title: 'Multi-version Node matrix',
    level: nodeReady.length ? 'ready' : 'degraded',
    detail: nodeReady.length
      ? `Available majors: ${nodeReady.join(', ')}`
      : `Supported ${listSupportedRuntimes().node.join(', ')} — none probed`,
    spec: '§4.2',
    fixHint: 'ysk-server hosting runtime-install --kind node --version 20',
  });
  push({
    id: 'runtimes-php',
    category: 'hosting',
    title: 'Multi-version PHP matrix',
    level: phpReady.length ? 'ready' : 'degraded',
    detail: phpReady.length
      ? `Available: ${phpReady.join(', ')}`
      : `Supported ${listSupportedRuntimes().php.join(', ')} — none probed`,
    spec: '§4.3',
    fixHint: 'ysk-server hosting runtime-install --kind php --version 8.2',
  });

  const pm2 = await probePm2(host);
  push({
    id: 'pm2',
    category: 'hosting',
    title: 'PM2 process manager',
    level: pm2.available ? 'ready' : 'degraded',
    detail: pm2.available ? `pm2 at ${pm2.path}` : 'pm2 not on PATH (pidfile/systemd still work)',
    spec: '§4.2',
    fixHint: 'npm i -g pm2',
  });

  const pdns = await probePowerDns(host);
  push({
    id: 'powerdns',
    category: 'dns',
    title: 'PowerDNS tools',
    level: pdns.available ? 'ready' : 'degraded',
    detail: pdns.notes.join('; ') || 'not installed',
    spec: '§4.8',
    fixHint: 'ysk-server hosting powerdns-install',
  });

  const webDist = join(process.cwd(), 'apps/web/dist/index.html');
  const webAlt = existsSync(join(input.dataDir, 'web/index.html'));
  push({
    id: 'web-ui',
    category: 'core',
    title: 'Web UI build',
    level: existsSync(webDist) || webAlt ? 'ready' : 'degraded',
    detail: existsSync(webDist)
      ? 'apps/web/dist present'
      : webAlt
        ? 'dataDir/web present'
        : 'Web UI not built — API-only mode',
    spec: '§3.9',
    fixHint: 'pnpm --filter @ysk/web build',
  });

  push({
    id: 'email-managed',
    category: 'email',
    title: 'Email managed configs dir',
    level: existsSync(join(input.dataDir, 'email')) ? 'ready' : 'degraded',
    detail: existsSync(join(input.dataDir, 'email'))
      ? 'dataDir/email exists'
      : 'No email domains applied yet',
    spec: '§5',
    fixHint: 'Create email domain + system email/apply',
  });

  const ready = items.filter((i) => i.level === 'ready').length;
  const degraded = items.filter((i) => i.level === 'degraded').length;
  const missing = items.filter((i) => i.level === 'missing').length;
  const criticalMissing = items.filter(
    (i) => i.level === 'missing' && (i.id === 'bin-nginx' || i.id === 'bin-node' || i.id === 'control-plane'),
  );

  const productionReady =
    mode === 'production_capable' &&
    criticalMissing.length === 0 &&
    items.find((i) => i.id === 'bin-nginx')?.level === 'ready' &&
    items.find((i) => i.id === 'bin-node')?.level === 'ready';

  const summary: string[] = [
    `Mode: ${mode}`,
    productionReady
      ? 'Production gates: PASS (root+EXECUTE+nginx+node)'
      : 'Production gates: NOT fully met — see missing/degraded items',
    `Score ready=${ready} degraded=${degraded} missing=${missing} / ${items.length}`,
  ];
  if (!executeEnabled) {
    summary.push('Set YSK_EXECUTE=1 for system mutations (never faked).');
  }
  if (!isRoot) {
    summary.push('Run as root for useradd, systemd, nginx system conf.d.');
  }

  return {
    product: input.product ?? 'YSK Server',
    generatedAt: new Date().toISOString(),
    mode,
    executeEnabled,
    isRoot,
    score: { ready, degraded, missing, total: items.length },
    items,
    summary,
    productionReady,
  };
}
