import { tl } from 'ysk-server-shared';
/**
 * Host service matrix — real systemctl probes for known panel services.
 * Used by /services page (not a fake protection-only probe).
 */

import type { HostExecutor } from '../host/executor.js';
import { HostSoftwareProbe, binPresent } from './software-probe/index.js';

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
  /** Empty unit = toolchain/tool row (no systemd lifecycle) */
  unit: string;
  href?: string;
  categoryKey: string;
  /** Binary hints when no softwareProbeId */
  bins?: string[];
  /** Prefer HostSoftwareProbe.presence(id) for exclusive/catalog rules */
  softwareProbeId?: string;
}> = [
  { id: 'nginx', label: 'Nginx', unit: 'nginx', href: '/nginx', categoryKey: 'notes.auto.n1318', softwareProbeId: 'nginx', bins: ['nginx'] },
  { id: 'apache', label: 'Apache', unit: 'apache2', href: '/apache', categoryKey: 'notes.auto.n1318', softwareProbeId: 'apache2', bins: ['apache2', 'httpd'] },
  {
    id: 'mysql',
    label: 'MySQL',
    unit: 'mysql',
    href: '/databases/mysql/service',
    categoryKey: 'notes.cat.database',
    softwareProbeId: 'mysql-server',
    bins: ['mysqld'],
  },
  {
    id: 'mariadb',
    label: 'MariaDB',
    unit: 'mariadb',
    href: '/databases/mariadb/service',
    categoryKey: 'notes.cat.database',
    softwareProbeId: 'mariadb-server',
    bins: ['mariadbd'],
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    unit: 'postgresql',
    href: '/databases/postgres/service',
    categoryKey: 'notes.cat.database',
    softwareProbeId: 'postgresql',
    bins: ['postgres', 'psql'],
  },
  {
    id: 'redis',
    label: 'Redis',
    unit: 'redis-server',
    href: '/databases/redis/service',
    categoryKey: 'notes.cat.database',
    softwareProbeId: 'redis-server',
    bins: ['redis-server', 'redis-cli'],
  },
  { id: 'vsftpd', label: 'vsftpd (FTPS)', unit: 'vsftpd', href: '/ftp/service', categoryKey: 'notes.auto.n1019', softwareProbeId: 'vsftpd', bins: ['vsftpd'] },
  {
    id: 'fail2ban',
    label: 'fail2ban',
    unit: 'fail2ban',
    href: '/protection/fail2ban',
    categoryKey: 'notes.readiness.security',
    softwareProbeId: 'fail2ban',
    bins: ['fail2ban-client'],
  },
  {
    id: 'ufw',
    labelKey: 'notes.auto.n0017',
    unit: 'ufw',
    href: '/protection/firewall',
    categoryKey: 'notes.readiness.security',
    softwareProbeId: 'ufw',
    bins: ['ufw'],
  },
  { id: 'postfix', label: 'Postfix', unit: 'postfix', href: '/email', categoryKey: 'notes.readiness.email', softwareProbeId: 'postfix', bins: ['postfix'] },
  { id: 'dovecot', label: 'Dovecot', unit: 'dovecot', href: '/email', categoryKey: 'notes.readiness.email', softwareProbeId: 'dovecot', bins: ['dovecot'] },
  { id: 'opendkim', label: 'OpenDKIM', unit: 'opendkim', href: '/email', categoryKey: 'notes.readiness.email', softwareProbeId: 'opendkim', bins: ['opendkim'] },
  { id: 'pdns', label: 'PowerDNS', unit: 'pdns', href: '/dns', categoryKey: 'notes.auto.n1318', softwareProbeId: 'pdns-server', bins: ['pdns_server'] },
  { id: 'sshd', label: 'sshd', unit: 'ssh', href: '/security', categoryKey: 'notes.readiness.security', bins: ['sshd'] },
  { id: 'wireguard', label: 'WireGuard', unit: 'wg-quick@wg0', href: '/vpn', categoryKey: 'notes.readiness.security', softwareProbeId: 'wireguard', bins: ['wg', 'wg-quick'] },
  { id: 'openvpn', label: 'OpenVPN', unit: 'openvpn-server@ysk', href: '/vpn', categoryKey: 'notes.readiness.security', softwareProbeId: 'openvpn', bins: ['openvpn'] },
  { id: 'outline', label: 'Shadowsocks', unit: 'ysk-ss-server', href: '/vpn', categoryKey: 'notes.readiness.security', softwareProbeId: 'shadowsocks', bins: ['ss-server'] },
  { id: 'php-fpm', label: 'PHP-FPM', unit: 'php8.2-fpm', href: '/runtimes/php', categoryKey: 'notes.auto.n0018', softwareProbeId: 'php', bins: ['php-fpm8.2', 'php-fpm', 'php'] },
  { id: 'java', label: 'Java', unit: '', href: '/runtimes/java', categoryKey: 'notes.cat.runtime', softwareProbeId: 'java', bins: ['java', 'javac'] },
  { id: 'kotlin', label: 'Kotlin', unit: '', href: '/runtimes/kotlin', categoryKey: 'notes.cat.runtime', softwareProbeId: 'kotlin', bins: ['kotlin', 'kotlinc'] },
  { id: 'bun', label: 'Bun', unit: '', href: '/runtimes/bun', categoryKey: 'notes.cat.runtime', softwareProbeId: 'bun', bins: ['bun'] },
  { id: 'ysk-server', labelKey: 'notes.tpl.yskControlPlane', unit: 'ysk-server', href: '/system/unit', categoryKey: 'notes.readiness.core' },
];

function resolveCatalogLabel(entry: (typeof CATALOG)[number]): string {
  if (entry.labelKey) return tl(entry.labelKey);
  return entry.label ?? entry.id;
}

function activeLabel(active: string, installed: boolean): string {
  if (!installed && active !== 'active') return tl('notes.notInstalled');
  if (active === 'tool') return tl('notes.installedTool');
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

async function isEntryInstalled(
  host: HostExecutor,
  probe: HostSoftwareProbe,
  entry: (typeof CATALOG)[number],
): Promise<boolean> {
  if (entry.softwareProbeId) {
    return probe.isInstalled(entry.softwareProbeId);
  }
  if (entry.id === 'ysk-server') {
    return (await binPresent(host, 'ysk-server')) || (await binPresent(host, 'node'));
  }
  for (const b of entry.bins ?? []) {
    if (await binPresent(host, b)) return true;
  }
  return false;
}

/** Alternate units for distro differences */
const UNIT_ALIASES: Record<string, string[]> = {
  mysql: ['mysql', 'mysqld'],
  redis: ['redis-server', 'redis'],
  postgres: ['postgresql', 'postgresql@16-main', 'postgresql@15-main', 'postgresql@14-main'],
  'php-fpm': ['php8.3-fpm', 'php8.2-fpm', 'php8.1-fpm', 'php-fpm'],
  apache: ['apache2', 'httpd'],
  sshd: ['ssh', 'sshd'],
  openvpn: ['openvpn-server@ysk', 'openvpn@ysk'],
};

export async function getServiceMatrix(host: HostExecutor): Promise<{
  items: ServiceMatrixItem[];
  executeEnabled: boolean;
  isRoot: boolean;
  probedAt: string;
}> {
  const items: ServiceMatrixItem[] = [];
  const probe = new HostSoftwareProbe(host);

  for (const entry of CATALOG) {
    const label = resolveCatalogLabel(entry);
    const category = tl(entry.categoryKey);
    // Product-semantic installed (MySQL vs MariaDB exclusive, etc.)
    const installed = await isEntryInstalled(host, probe, entry);

    // Toolchain rows (no systemd unit): installed vs not — no start/stop
    if (!entry.unit) {
      items.push({
        id: entry.id,
        label,
        unit: '—',
        href: entry.href,
        category,
        installed,
        active: installed ? 'tool' : 'not-found',
        enabled: 'n/a',
        activeLabel: activeLabel(installed ? 'tool' : 'not-found', installed),
      });
      continue;
    }

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

    // not-found from systemctl when package missing
    if (!installed) {
      items.push({
        id: entry.id,
        label,
        unit: bestUnit,
        href: entry.href,
        category,
        installed: false,
        active: 'not-found',
        enabled: bestEnabled,
        activeLabel: activeLabel('not-found', false),
      });
      continue;
    }

    if (bestActive === 'unknown' || bestActive === 'not-found') {
      bestActive = 'inactive';
    }

    if (entry.id === 'ufw' && installed) {
      try {
        const st = await host.runCommand(['ufw', 'status'], { timeoutMs: 5_000 });
        const text = `${st.stdout || ''}\n${st.stderr || ''}`;
        if (/inactive/i.test(text.slice(0, 240))) {
          bestActive = 'inactive';
        }
      } catch {
        /* keep unit probe */
      }
    }

    items.push({
      id: entry.id,
      label,
      unit: bestUnit,
      href: entry.href,
      category,
      installed: true,
      active: bestActive,
      enabled: bestEnabled,
      activeLabel: activeLabel(bestActive, true),
    });
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
  if (!safe || safe === '—' || safe === '-') {
    return { ok: false, notes: [tl('notes.auto.n1107')] };
  }

  const notes: string[] = [];
  // Postfix: missing main.cf → systemd ConditionPathExists skips start (inactive, not crash)
  const base = safe.replace(/\.service$/, '');
  if ((action === 'start' || action === 'restart') && (base === 'postfix' || safe === 'postfix.service')) {
    try {
      const { preparePostfixForStart, ensurePostfixMainCf } = await import('./postfix-bootstrap.js');
      const prep = await preparePostfixForStart(host);
      notes.push(...prep.notes);
      if (!prep.ok) {
        const heal = await ensurePostfixMainCf(host);
        notes.push(...heal.notes);
      }
    } catch {
      /* best-effort */
    }
  }

  let r = await host.runCommand(['systemctl', action, safe], { timeoutMs: 60_000 });
  // If still down, try one more ensure + start (e.g. first ensure raced with pathExists)
  if (
    r.exitCode !== 0 &&
    (action === 'start' || action === 'restart') &&
    (base === 'postfix' || safe === 'postfix.service')
  ) {
    try {
      const { ensurePostfixMainCf } = await import('./postfix-bootstrap.js');
      const heal = await ensurePostfixMainCf(host);
      notes.push(...heal.notes);
      if (heal.ok || heal.created) {
        r = await host.runCommand(['systemctl', 'start', safe], { timeoutMs: 60_000 });
      }
    } catch {
      /* fall through */
    }
  }

  const p = await probeUnit(host, safe);
  const ok = r.exitCode === 0;
  if (ok) {
    notes.push(tl('notes.auto.t0316', { v0: action, v1: safe }));
  } else {
    notes.push(
      tl('notes.tpl.actionFailed', {
        action,
        detail: (r.stderr || r.stdout).trim() || String(r.exitCode),
      }),
    );
  }
  return {
    ok,
    notes,
    active: p.active };
}
