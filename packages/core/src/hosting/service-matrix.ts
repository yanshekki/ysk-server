import { tl } from '@ysk/shared';
/**
 * Host service matrix — real systemctl probes for known panel services.
 * Used by /services page (not a fake protection-only probe).
 */

import type { HostExecutor } from '../host/executor.js';

export type ServiceMatrixItem = {
  id: string;
  label: string;
  unit: string;
  /** Panel deep-link when available */
  href?: string;
  category: string;
  installed: boolean;
  active: string;
  enabled: string;
  activeLabel: string;
};

/**
 * Static catalog — never call tl() here (module load freezes default locale).
 * Resolve label/category keys inside getServiceMatrix under request locale.
 */
const CATALOG: Array<{
  id: string;
  /** Literal brand name, or i18n key when labelKey set */
  label?: string;
  labelKey?: string;
  unit: string;
  href?: string;
  categoryKey: string;
  /** Binary hints for "installed" when unit missing */
  bins?: string[];
}> = [
  { id: 'nginx', label: 'Nginx', unit: 'nginx', href: '/nginx', categoryKey: 'notes.auto.n1318', bins: ['nginx'] },
  { id: 'mysql', label: 'MySQL', unit: 'mysql', href: '/databases/mysql/service', categoryKey: 'notes.cat.database', bins: ['mysqld', 'mysql'] },
  { id: 'mariadb', label: 'MariaDB', unit: 'mariadb', href: '/databases/mariadb/service', categoryKey: 'notes.cat.database', bins: ['mariadbd', 'mariadb'] },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    unit: 'postgresql',
    href: '/databases/postgres/service',
    categoryKey: 'notes.cat.database',
    bins: ['postgres', 'psql'] },
  { id: 'redis', label: 'Redis', unit: 'redis-server', href: '/databases/redis/service', categoryKey: 'notes.cat.database', bins: ['redis-server', 'redis-cli'] },
  { id: 'vsftpd', label: 'vsftpd (FTPS)', unit: 'vsftpd', href: '/ftp/service', categoryKey: 'notes.auto.n1019', bins: ['vsftpd'] },
  { id: 'fail2ban', label: 'fail2ban', unit: 'fail2ban', href: '/protection/fail2ban', categoryKey: 'notes.readiness.security', bins: ['fail2ban-client'] },
  { id: 'ufw', labelKey: 'notes.auto.n0017', unit: 'ufw', href: '/protection/firewall', categoryKey: 'notes.readiness.security', bins: ['ufw'] },
  { id: 'postfix', label: 'Postfix', unit: 'postfix', href: '/email', categoryKey: 'notes.readiness.email', bins: ['postfix'] },
  { id: 'dovecot', label: 'Dovecot', unit: 'dovecot', href: '/email', categoryKey: 'notes.readiness.email', bins: ['dovecot'] },
  { id: 'php-fpm', label: 'PHP-FPM', unit: 'php8.2-fpm', href: '/runtimes/php', categoryKey: 'notes.auto.n0018', bins: ['php-fpm8.2', 'php-fpm'] },
  { id: 'ysk-server', labelKey: 'notes.tpl.yskControlPlane', unit: 'ysk-server', href: '/system/unit', categoryKey: 'notes.readiness.core' },
];

function resolveCatalogLabel(entry: (typeof CATALOG)[number]): string {
  if (entry.labelKey) return tl(entry.labelKey);
  return entry.label ?? entry.id;
}

function activeLabel(active: string, installed: boolean): string {
  if (!installed && active !== 'active') return tl('notes.notInstalled');
  if (active === 'active') return tl('notes.running');
  if (active === 'inactive') return tl('notes.stopped');
  if (active === 'failed') return tl('notes.failed');
  if (active === 'activating') return tl('notes.auto.n0014');
  return active || tl('notes.unknown');
}

async function probeUnit(
  host: HostExecutor,
  unit: string,
): Promise<{ active: string; enabled: string }> {
  let active = 'unknown';
  let enabled = 'unknown';
  try {
    const a = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 4_000 });
    active = (a.stdout || a.stderr || 'unknown').trim().split(/\s+/)[0] || 'unknown';
  } catch {
    active = 'unknown';
  }
  try {
    const e = await host.runCommand(['systemctl', 'is-enabled', unit], { timeoutMs: 4_000 });
    enabled = (e.stdout || e.stderr || 'unknown').trim().split(/\s+/)[0] || 'unknown';
  } catch {
    enabled = 'unknown';
  }
  return { active, enabled };
}

async function hasAnyBin(host: HostExecutor, bins?: string[]): Promise<boolean> {
  if (!bins?.length) return false;
  for (const b of bins) {
    try {
      if (host.pathExists(`/usr/sbin/${b}`) || host.pathExists(`/usr/bin/${b}`) || host.pathExists(`/bin/${b}`)) {
        return true;
      }
      const r = await host.runCommand(['bash', '-c', `command -v ${b} >/dev/null 2>&1 && echo yes || echo no`], {
        timeoutMs: 3_000 });
      if ((r.stdout || '').trim() === 'yes') return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

/** Alternate units for distro differences */
const UNIT_ALIASES: Record<string, string[]> = {
  mysql: ['mysql', 'mysqld'],
  redis: ['redis-server', 'redis'],
  postgres: ['postgresql', 'postgresql@16-main', 'postgresql@15-main', 'postgresql@14-main'],
  'php-fpm': ['php8.3-fpm', 'php8.2-fpm', 'php8.1-fpm', 'php-fpm'] };

export async function getServiceMatrix(host: HostExecutor): Promise<{
  items: ServiceMatrixItem[];
  executeEnabled: boolean;
  isRoot: boolean;
  probedAt: string;
}> {
  const items: ServiceMatrixItem[] = [];

  for (const entry of CATALOG) {
    const aliases = UNIT_ALIASES[entry.id] ?? [entry.unit];
    let bestActive = 'unknown';
    let bestEnabled = 'unknown';
    let bestUnit = entry.unit;

    for (const u of aliases) {
      const p = await probeUnit(host, u);
      if (p.active === 'active' || (bestActive === 'unknown' && p.active !== 'unknown' && p.active !== 'not-found' && p.active !== 'inactive')) {
        bestActive = p.active;
        bestEnabled = p.enabled;
        bestUnit = u;
        if (p.active === 'active') break;
      } else if (bestActive === 'unknown') {
        bestActive = p.active;
        bestEnabled = p.enabled;
        bestUnit = u;
      }
    }

    const label = resolveCatalogLabel(entry);
    const category = tl(entry.categoryKey);

    // not-found from systemctl often means inactive wording differs — normalize
    if (bestActive === 'unknown' || bestActive === 'not-found') {
      const binOk = await hasAnyBin(host, entry.bins);
      items.push({
        id: entry.id,
        label,
        unit: bestUnit,
        href: entry.href,
        category,
        installed: binOk,
        active: binOk ? 'inactive' : 'not-found',
        enabled: bestEnabled,
        activeLabel: activeLabel(binOk ? 'inactive' : 'not-found', binOk) });
      continue;
    }

    const installed =
      bestActive === 'active' ||
      bestActive === 'inactive' ||
      bestActive === 'failed' ||
      bestActive === 'activating' ||
      (await hasAnyBin(host, entry.bins));

    items.push({
      id: entry.id,
      label,
      unit: bestUnit,
      href: entry.href,
      category,
      installed,
      active: bestActive,
      enabled: bestEnabled,
      activeLabel: activeLabel(bestActive, installed) });
  }

  return {
    items,
    executeEnabled: host.executeEnabled(),
    isRoot: host.isRoot(),
    probedAt: new Date().toISOString() };
}

export async function lifecycleServiceUnit(
  host: HostExecutor,
  unit: string,
  action: 'start' | 'stop' | 'restart' | 'reload',
): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  active?: string;
}> {
  if (!host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('ops.blocked.needExecute'),
      notes: [tl('notes.auto.n0006')] };
  }
  if (!host.isRoot()) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('notes.auto.n0008'),
      notes: [tl('notes.auto.n1570')] };
  }
  const safe = unit.replace(/[^a-zA-Z0-9@._-]/g, '');
  if (!safe) return { ok: false, notes: [tl('notes.auto.n1107')] };
  const r = await host.runCommand(['systemctl', action, safe], { timeoutMs: 60_000 });
  const p = await probeUnit(host, safe);
  const ok = r.exitCode === 0;
  return {
    ok,
    notes: ok
      ? [tl('notes.auto.t0316', { v0: (action), v1: (safe) })]
      : [tl('notes.tpl.actionFailed', { action: action, detail: (r.stderr || r.stdout).trim() || String(r.exitCode) })],
    active: p.active };
}
