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

const CATALOG: Array<{
  id: string;
  label: string;
  unit: string;
  href?: string;
  category: string;
  /** Binary hints for "installed" when unit missing */
  bins?: string[];
}> = [
  { id: 'nginx', label: 'Nginx', unit: 'nginx', href: '/nginx', category: '網頁', bins: ['nginx'] },
  { id: 'mysql', label: 'MySQL', unit: 'mysql', href: '/databases/mysql/service', category: '資料庫', bins: ['mysqld', 'mysql'] },
  { id: 'mariadb', label: 'MariaDB', unit: 'mariadb', href: '/databases/mariadb/service', category: '資料庫', bins: ['mariadbd', 'mariadb'] },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    unit: 'postgresql',
    href: '/databases/postgres/service',
    category: '資料庫',
    bins: ['postgres', 'psql'],
  },
  { id: 'redis', label: 'Redis', unit: 'redis-server', href: '/databases/redis/service', category: '資料庫', bins: ['redis-server', 'redis-cli'] },
  { id: 'vsftpd', label: 'vsftpd (FTPS)', unit: 'vsftpd', href: '/ftp/service', category: '檔案', bins: ['vsftpd'] },
  { id: 'fail2ban', label: 'fail2ban', unit: 'fail2ban', href: '/fail2ban', category: '安全', bins: ['fail2ban-client'] },
  { id: 'ufw', label: 'UFW 防火牆', unit: 'ufw', href: '/firewall', category: '安全', bins: ['ufw'] },
  { id: 'postfix', label: 'Postfix', unit: 'postfix', href: '/email', category: '郵件', bins: ['postfix'] },
  { id: 'dovecot', label: 'Dovecot', unit: 'dovecot', href: '/email', category: '郵件', bins: ['dovecot'] },
  { id: 'php-fpm', label: 'PHP-FPM', unit: 'php8.2-fpm', href: '/runtimes/php', category: '執行環境', bins: ['php-fpm8.2', 'php-fpm'] },
  { id: 'ysk-server', label: 'YSK 控制面', unit: 'ysk-server', href: '/system/unit', category: '控制面' },
];

function activeLabel(active: string, installed: boolean): string {
  if (!installed && active !== 'active') return '未安裝';
  if (active === 'active') return '運行中';
  if (active === 'inactive') return '已停止';
  if (active === 'failed') return '失敗';
  if (active === 'activating') return '啟動中';
  return active || '未知';
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
        timeoutMs: 3_000,
      });
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
  'php-fpm': ['php8.3-fpm', 'php8.2-fpm', 'php8.1-fpm', 'php-fpm'],
};

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

    // not-found from systemctl often means inactive wording differs — normalize
    if (bestActive === 'unknown' || bestActive === 'not-found') {
      const binOk = await hasAnyBin(host, entry.bins);
      items.push({
        id: entry.id,
        label: entry.label,
        unit: bestUnit,
        href: entry.href,
        category: entry.category,
        installed: binOk,
        active: binOk ? 'inactive' : 'not-found',
        enabled: bestEnabled,
        activeLabel: activeLabel(binOk ? 'inactive' : 'not-found', binOk),
      });
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
      label: entry.label,
      unit: bestUnit,
      href: entry.href,
      category: entry.category,
      installed,
      active: bestActive,
      enabled: bestEnabled,
      activeLabel: activeLabel(bestActive, installed),
    });
  }

  return {
    items,
    executeEnabled: host.executeEnabled(),
    isRoot: host.isRoot(),
    probedAt: new Date().toISOString(),
  };
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
      blockMessage: '伺服器未開啟系統變更權限，無法在管理面板完成此操作',
      notes: ['需要系統變更權限'],
    };
  }
  if (!host.isRoot()) {
    return {
      ok: false,
      blocked: true,
      blockMessage: '需要系統管理員（root）權限才能完成',
      notes: ['需要 root'],
    };
  }
  const safe = unit.replace(/[^a-zA-Z0-9@._-]/g, '');
  if (!safe) return { ok: false, notes: ['無效 unit'] };
  const r = await host.runCommand(['systemctl', action, safe], { timeoutMs: 60_000 });
  const p = await probeUnit(host, safe);
  const ok = r.exitCode === 0;
  return {
    ok,
    notes: ok
      ? [`已 ${action} ${safe}`]
      : [`${action} 失敗: ${(r.stderr || r.stdout).trim() || String(r.exitCode)}`],
    active: p.active,
  };
}
