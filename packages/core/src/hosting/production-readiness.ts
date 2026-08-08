import { getLocale, tl } from '@ysk/shared';
/**
 * Spec-aligned production readiness probe — honest report, never over-claim.
 * Maps to AI-Secure-Linux-Server-Manager-Spec phases / hosting gates.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductionReadinessDto, ReadinessItemDto } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';

import { probeRuntimes } from './runtime-probe.js';
import { probePowerDns } from './powerdns-apply.js';
import { probePm2 } from './pm2-apply.js';
import { buildProjectIsolationReadinessItems } from './project-isolation-status.js';
import { binPresent } from './software-probe/index.js';
import { assessWebUiFix } from './web-ui-build.js';

export type { ReadinessLevel } from '@ysk/shared';
export type ReadinessItem = ReadinessItemDto;

/** Core report uses required blockers/categories (always filled by assessor). */
export type ProductionReadinessReport = ProductionReadinessDto & {
  mode: 'production_capable' | 'degraded';
  blockers: ReadinessItemDto[];
  categories: string[];
};

/** Human category labels (UI may re-map) */
export const READINESS_CATEGORY_ORDER = [
  'core',
  'security',
  'binaries',
  'hosting',
  'dns',
  'email',
  'isolation',
  'ops',
] as const;

export function readinessCategoryLabel(cat: string): string {
  const map: Record<string, string> = {
    core: tl('notes.readiness.core'),
    security: tl('notes.auto.n1029'),
    binaries: tl('notes.auto.n1312'),
    hosting: tl('notes.auto.n0018'),
    dns: tl('notes.readiness.dns'),
    email: tl('notes.readiness.email'),
    isolation: tl('notes.readiness.isolation'),
    ops: tl('notes.auto.n1473') };
  return map[cat] ?? cat;
}

async function hasCmd(host: HostExecutor, bin: string): Promise<boolean> {
  return binPresent(host, bin);
}

/**
 * Build full readiness report for operators / install gate.
 */
export async function assessProductionReadiness(input: {
  dataDir: string;
  host: HostExecutor;
  product?: string;
  version?: string;
  /** Optional project list for isolation gate */
  projects?: Array<{
    id: string;
    name: string;
    linuxUser: string;
    homeDir: string;
    osProvisioned: boolean;
  }>;
  /**
   * Optional live control-plane store (G4).
   * When set: report store backend, last backup age, fleet sessions.
   */
  db?: {
    snapshot: {
      projects?: unknown[];
      users?: unknown[];
      settings?: Record<string, string | undefined>;
      agent_sessions?: Array<{ status?: string }>;
    };
  };
  /** Explicit store kind label from open path (json|sqlite|postgres) */
  storeKind?: string;
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
    title: tl('notes.auto.n0893'),
    level: existsSync(input.dataDir) ? 'ready' : 'missing',
    detail: input.dataDir,
    spec: '§2.3',
    fixHint: tl('notes.auto.n1424'),
    fixHref: '/system',
    severity: 'critical' });

  push({
    id: 'execute-policy',
    category: 'security',
    title: tl('notes.auto.n1310'),
    level: executeEnabled ? 'ready' : 'degraded',
    detail: executeEnabled
      ? tl('notes.auto.n0812')
      : tl('notes.auto.n0985'),
    spec: '§3.2',
    fixHint: tl('notes.auto.n0515'),
    fixHref: '/system',
    severity: 'critical' });

  push({
    id: 'root',
    category: 'security',
    title: tl('notes.auto.n1308'),
    level: isRoot ? 'ready' : 'degraded',
    detail: isRoot
      ? tl('notes.auto.n0021')
      : tl('notes.auto.n1591'),
    spec: '§4.1',
    fixHint: tl('notes.auto.n0514'),
    fixHref: '/system/unit',
    severity: 'critical' });

  // Admin 2FA policy / enrollment (read-only open of panel store)
  try {
    const { openDatabase, closeDatabase } = await import('../db/database.js');
    const { join } = await import('node:path');
    const candidates = [
      join(input.dataDir, 'ysk.json'),
      join(input.dataDir, 'ysk.sqlite'),
      join(input.dataDir, 'db.json'),
    ];
    const dbPath = candidates.find((p) => existsSync(p) || existsSync(p.replace(/\.sqlite$/, '.json')));
    if (dbPath) {
      const db = openDatabase(dbPath);
      try {
        const requireTotp =
          db.snapshot.settings?.['security.require_admin_totp'] === '1' ||
          db.snapshot.settings?.['security.require_admin_totp'] === 'true';
        const admins = (db.snapshot.users ?? []).filter((u) =>
          Array.isArray(u.roles) && u.roles.includes('admin' as never),
        );
        const with2fa = admins.filter((u) => u.totp_enabled);
        const allOk = admins.length > 0 && with2fa.length === admins.length;
        push({
          id: 'admin-2fa',
          category: 'security',
          title: tl('notes.auto.n0022'),
          level: allOk
            ? 'ready'
            : requireTotp
              ? with2fa.length
                ? 'degraded'
                : 'missing'
              : with2fa.length
                ? 'degraded'
                : 'missing',
          detail: requireTotp
            ? tl('notes.auto.t0384', { v0: (with2fa.length), v1: (admins.length) })
            : tl('notes.auto.t0385', { v0: (with2fa.length), v1: (admins.length) }),
          spec: '§3.1',
          fixHint: tl('notes.auto.n0650'),
          fixHref: '/security?tab=account',
          severity: requireTotp ? 'critical' : 'recommended' });
      } finally {
        closeDatabase(db);
      }
    }
  } catch {
    push({
      id: 'admin-2fa',
      category: 'security',
      title: tl('notes.auto.n0022'),
      level: 'unknown',
      detail: tl('notes.auto.n1187'),
      severity: 'recommended',
      fixHref: '/security?tab=account' });
  }

  // Admin weak/bootstrap password + dataDir permissions + public listen
  try {
    const { openDatabase, closeDatabase } = await import('../db/database.js');
    const { join: pathJoin } = await import('node:path');
    const { statSync } = await import('node:fs');
    const dbPath = pathJoin(input.dataDir, 'ysk.json');
    if (existsSync(dbPath)) {
      const db = openDatabase(dbPath);
      try {
        const admins = (db.snapshot.users ?? []).filter(
          (u) => Array.isArray(u.roles) && u.roles.includes('admin' as never),
        );
        const mustChange = admins.filter((u) => u.must_change_password).length;
        const insecureBootstrap =
          db.snapshot.settings?.['security.bootstrap_insecure'] === '1';
        const weakLevel =
          mustChange > 0 || insecureBootstrap
            ? 'missing'
            : 'ready';
        push({
          id: 'admin-password',
          category: 'security',
          title: tl('readiness.itemAdminPassword'),
          level: weakLevel,
          detail:
            mustChange > 0 || insecureBootstrap
              ? tl('readiness.itemAdminPasswordWeak', { count: mustChange })
              : tl('readiness.itemAdminPasswordOk'),
          fixHint: tl('readiness.itemAdminPasswordFix'),
          fixHref: '/security?tab=account',
          severity: 'critical',
          spec: '§3.1',
        });

        const publicListen = db.snapshot.settings?.['security.listen_public'] === '1';
        push({
          id: 'listen-bind',
          category: 'security',
          title: tl('readiness.itemListenBind'),
          level: publicListen ? 'degraded' : 'ready',
          detail: publicListen
            ? tl('readiness.itemListenBindPublic')
            : tl('readiness.itemListenBindLoopback'),
          fixHref: '/system',
          severity: 'recommended',
          spec: '§3.2',
        });
      } finally {
        closeDatabase(db);
      }
    }

    // dataDir mode: warn if world-writable or other-readable on sensitive store
    try {
      const st = statSync(input.dataDir);
      const mode = st.mode & 0o777;
      const worldW = (mode & 0o002) !== 0;
      const otherR = (mode & 0o004) !== 0;
      const needsFix = worldW || otherR;
      push({
        id: 'datadir-perms',
        category: 'security',
        title: tl('readiness.itemDataDirPerms'),
        level: worldW ? 'missing' : otherR ? 'degraded' : 'ready',
        detail: `mode ${mode.toString(8)} · ${input.dataDir}`,
        fixHint: worldW
          ? tl('readiness.itemDataDirWorldW')
          : otherR
            ? tl('readiness.itemDataDirOtherR')
            : undefined,
        // One-click chmod 750 from readiness UI / install repair
        fixAction: needsFix ? 'harden-datadir' : undefined,
        severity: worldW ? 'critical' : 'recommended',
        spec: '§2.3',
      });
    } catch {
      /* ignore */
    }
  } catch {
    /* optional hardening probes */
  }

  const bins: Array<{
    id: string;
    bin: string;
    title: string;
    spec: string;
    critical?: boolean;
    fixHref?: string;
  }> = [
    {
      id: 'bin-nginx',
      bin: 'nginx',
      title: tl('notes.auto.n0342'),
      spec: '§4.7',
      critical: true,
      fixHref: '/nginx' },
    {
      id: 'bin-node',
      bin: 'node',
      title: tl('notes.auto.n0346'),
      spec: '§4.2',
      critical: true,
      fixHref: '/runtimes/node' },
    { id: 'bin-git', bin: 'git', title: tl('notes.auto.n0301'), spec: '§4.2', fixHref: '/runtimes/node' },
    { id: 'bin-php', bin: 'php', title: tl('notes.auto.n0375'), spec: '§4.3', fixHref: '/runtimes/php' },
    {
      id: 'bin-python',
      bin: 'python3',
      title: tl('notes.auto.n0396'),
      spec: '§4.2',
      fixHref: '/runtimes/python' },
    { id: 'bin-go', bin: 'go', title: tl('notes.auto.n0302'), spec: '§4.2', fixHref: '/runtimes/go' },
    {
      id: 'bin-cargo',
      bin: 'cargo',
      title: tl('notes.auto.n0235'),
      spec: '§4.2',
      fixHref: '/runtimes/rust' },
    {
      id: 'bin-mysql',
      bin: 'mysql',
      title: tl('notes.auto.n0334'),
      spec: '§4.4',
      fixHref: '/databases/mysql/service' },
    {
      id: 'bin-psql',
      bin: 'psql',
      title: tl('notes.auto.n0394'),
      spec: '§4.4',
      fixHref: '/databases/postgres/service' },
    {
      id: 'bin-redis',
      bin: 'redis-cli',
      title: 'redis-cli',
      spec: '§4.4',
      fixHref: '/databases/redis/service' },
    { id: 'bin-openssl', bin: 'openssl', title: tl('notes.auto.n0353'), spec: '§5', fixHref: '/email' },
    { id: 'bin-postfix', bin: 'postfix', title: 'postfix', spec: '§5', fixHref: '/email' },
    { id: 'bin-dovecot', bin: 'dovecot', title: 'dovecot', spec: '§5', fixHref: '/email' },
    { id: 'bin-certbot', bin: 'certbot', title: 'certbot', spec: '§4.6', fixHref: '/ssl' },
    { id: 'bin-ufw', bin: 'ufw', title: 'ufw', spec: '§4.9', fixHref: '/protection/firewall' },
    {
      id: 'bin-fail2ban',
      bin: 'fail2ban-client',
      title: 'fail2ban',
      spec: '§4.9',
      fixHref: '/protection/fail2ban' },
    {
      id: 'bin-pdnsutil',
      bin: 'pdnsutil',
      title: tl('readiness.itemPdnsutil'),
      spec: '§4.8',
      fixHref: '/dns' },
  ];

  for (const b of bins) {
    const ok = await hasCmd(host, b.bin);
    push({
      id: b.id,
      category: 'binaries',
      title: b.title,
      level: ok ? 'ready' : b.critical ? 'missing' : 'degraded',
      detail: ok ? tl('notes.auto.t0386', { v0: (b.bin) }) : tl('notes.auto.t0387', { v0: (b.bin) }),
      spec: b.spec,
      fixHint: ok ? undefined : tl('notes.auto.t0388', { v0: (b.bin) }),
      fixHref: ok ? undefined : b.fixHref,
      severity: b.critical ? 'critical' : 'optional' });
  }

  // Residual ondrej Launchpad PHP sources break apt (version skew with packages.sury.org)
  try {
    const src = await host.runCommand(
      [
        'bash',
        '-c',
        'ls /etc/apt/sources.list.d/*ondrej* 2>/dev/null; grep -rliE "ppa\\.launchpad\\.(net|content\\.com)/ondrej/php|launchpadcontent\\.com/ondrej/php" /etc/apt/sources.list.d 2>/dev/null | head -8; true',
      ],
      { timeoutMs: 8_000 },
    );
    const residual = (src.stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (residual.length) {
      push({
        id: 'apt-php-ondrej-residual',
        category: 'hosting',
        title: 'PHP apt source (ondrej residual)',
        level: 'degraded',
        detail: `Found legacy ondrej/php sources that conflict with packages.sury.org: ${residual.slice(0, 4).join(', ')}`,
        spec: '§4.3',
        fixHint:
          'Remove ondrej Launchpad lists; re-run PHP install from panel (pins packages.sury.org only)',
        fixHref: '/runtimes/php',
        severity: 'recommended',
      });
    } else {
      push({
        id: 'apt-php-ondrej-residual',
        category: 'hosting',
        title: 'PHP apt source (ondrej residual)',
        level: 'ready',
        detail: 'No ondrej Launchpad PHP sources detected',
        spec: '§4.3',
        severity: 'optional',
      });
    }
  } catch {
    /* probe optional */
  }

  const runtimes = await probeRuntimes(host);
  const nodeReady = runtimes.node.filter((n) => n.available).map((n) => n.version);
  const phpReady = runtimes.php.filter((p) => p.available).map((p) => p.version);
  const pyReady = runtimes.python.filter((p) => p.available).map((p) => p.version);
  const goReady = runtimes.go.filter((g) => g.available).map((g) => g.version);
  const rustReady = runtimes.rust.filter((r) => r.available).map((r) => r.version);
  push({
    id: 'runtimes-node',
    category: 'hosting',
    title: tl('notes.auto.n0141'),
    level: nodeReady.length ? 'ready' : 'degraded',
    detail: nodeReady.length
      ? tl('notes.auto.t0389', { v0: (nodeReady.join(', ')) })
      : tl('notes.tpl.supportedNotProbed', { name: 'dynamic (software/versions)' }),
    spec: '§4.2',
    fixHint: tl('notes.auto.n0910'),
    fixHref: nodeReady.length ? undefined : '/runtimes/node',
    severity: 'recommended' });
  push({
    id: 'runtimes-php',
    category: 'hosting',
    title: tl('notes.auto.n0146'),
    level: phpReady.length ? 'ready' : 'degraded',
    detail: phpReady.length
      ? tl('notes.tpl.available', { detail: phpReady.join(', ') })
      : tl('notes.tpl.supportedNotProbed', { name: 'dynamic (software/versions)' }),
    spec: '§4.3',
    fixHint: tl('notes.auto.n0911'),
    fixHref: phpReady.length ? undefined : '/runtimes/php',
    severity: 'optional' });
  push({
    id: 'runtimes-python',
    category: 'hosting',
    title: tl('notes.auto.n0164'),
    level: pyReady.length ? 'ready' : 'degraded',
    detail: pyReady.length
      ? tl('notes.tpl.available', { detail: pyReady.join(', ') })
      : tl('notes.tpl.supportedNotProbed', { name: 'dynamic (software/versions)' }),
    spec: '§4.2',
    fixHint: tl('notes.auto.n0912'),
    fixHref: pyReady.length ? undefined : '/runtimes/python',
    severity: 'optional' });
  push({
    id: 'runtimes-go',
    category: 'hosting',
    title: tl('notes.auto.n0113'),
    level: goReady.length ? 'ready' : 'degraded',
    detail: goReady.length
      ? tl('notes.tpl.available', { detail: goReady.join(', ') })
      : tl('notes.tpl.supportedNotProbed', { name: 'dynamic (software/versions)' }),
    spec: '§4.2',
    fixHint: tl('notes.auto.n0909'),
    fixHref: goReady.length ? undefined : '/runtimes/go',
    severity: 'optional' });
  push({
    id: 'runtimes-rust',
    category: 'hosting',
    title: tl('readiness.itemRustToolchain'),
    level: rustReady.length ? 'ready' : 'degraded',
    detail: rustReady.length
      ? tl('notes.tpl.available', { detail: rustReady.join(', ') })
      : tl('notes.tpl.supportedNotProbed', { name: 'dynamic (software/versions)' }),
    spec: '§4.2',
    fixHint: tl('notes.auto.n0913'),
    fixHref: rustReady.length ? undefined : '/runtimes/rust',
    severity: 'optional' });

  const pm2 = await probePm2(host);
  push({
    id: 'pm2',
    category: 'hosting',
    title: tl('notes.auto.n0153'),
    level: pm2.available ? 'ready' : 'degraded',
    detail: pm2.available
      ? `pm2：${pm2.path}`
      : tl('notes.auto.n0379'),
    spec: '§4.2',
    fixHint: tl('notes.auto.n0615'),
    fixHref: pm2.available ? undefined : '/runtimes/node',
    severity: 'optional' });

  const pdns = await probePowerDns(host);
  push({
    id: 'powerdns',
    category: 'dns',
    title: tl('notes.auto.n0161'),
    level: pdns.available ? 'ready' : 'degraded',
    detail: pdns.notes.join('；') || tl('notes.notInstalled'),
    spec: '§4.8',
    fixHint: tl('notes.auto.n0908'),
    fixHref: pdns.available ? undefined : '/dns',
    severity: 'optional' });

  const webAssess = assessWebUiFix(input.dataDir);
  const webReady = webAssess.ready;
  push({
    id: 'web-ui',
    category: 'core',
    title: tl('notes.auto.n0204'),
    level: webReady ? 'ready' : 'degraded',
    detail: webReady
      ? (webAssess.path ?? '')
      : tl('notes.auto.n0708'),
    spec: '§3.9',
    // One-click only when monorepo (or copyable source) exists — never fake "Fix now"
    fixHint: webReady
      ? undefined
      : webAssess.canAutoFix
        ? tl('readiness.itemWebBuildFix')
        : tl('readiness.itemWebBuildManual'),
    fixAction: webReady
      ? undefined
      : webAssess.canAutoFix
        ? 'build-web-ui'
        : undefined,
    severity: 'recommended' });

  push({
    id: 'email-managed',
    category: 'email',
    title: tl('notes.auto.n1507'),
    level: existsSync(join(input.dataDir, 'email')) ? 'ready' : 'degraded',
    detail: existsSync(join(input.dataDir, 'email'))
      ? tl('notes.auto.n0245')
      : tl('notes.auto.n0707'),
    spec: '§5',
    fixHint: tl('notes.auto.n0820'),
    fixHref: existsSync(join(input.dataDir, 'email')) ? undefined : '/email',
    severity: 'optional' });

  // Ops: resource pressure + key service activity (best-effort, never fake ready)
  try {
    const { collectMetrics } = await import('../monitoring/metrics.js');
    const m = collectMetrics('/');
    const diskPct =
      m.disk?.usedRatio != null ? Math.round(m.disk.usedRatio * 100) : null;
    const memPct = Math.round(m.memory.usedRatio * 100);
    push({
      id: 'ops-memory',
      category: 'ops',
      title: tl('notes.auto.n1358'),
      level: memPct >= 95 ? 'missing' : memPct >= 85 ? 'degraded' : 'ready',
      detail: tl('notes.auto.t0390', { v0: (memPct), v1: (Math.round(m.memory.total / 1024 / 1024)) }),
      fixHint: memPct >= 85 ? tl('notes.auto.n1023') : undefined,
      fixHref: memPct >= 85 ? '/metrics' : undefined,
      severity: 'recommended' });
    push({
      id: 'ops-disk',
      category: 'ops',
      title: tl('notes.auto.n1009'),
      level:
        diskPct == null
          ? 'unknown'
          : diskPct >= 95
            ? 'missing'
            : diskPct >= 85
              ? 'degraded'
              : 'ready',
      detail:
        diskPct == null
          ? tl('notes.auto.n1185')
          : tl('notes.auto.t0391', { v0: (diskPct), v1: (m.disk?.path ?? '/') }),
      fixHint: diskPct != null && diskPct >= 85 ? tl('notes.auto.n1052') : undefined,
      fixHref: diskPct != null && diskPct >= 85 ? '/system' : undefined,
      severity: 'recommended' });
    push({
      id: 'ops-load',
      category: 'ops',
      title: tl('notes.auto.n1311'),
      level:
        m.loadavg[0] > m.cpuCount * 3
          ? 'degraded'
          : m.loadavg[0] > m.cpuCount * 2
            ? 'degraded'
            : 'ready',
      detail: `load ${m.loadavg.map((x) => x.toFixed(2)).join(' / ')}（CPU ×${m.cpuCount}）`,
      fixHref: '/metrics',
      severity: 'optional' });
  } catch {
    push({
      id: 'ops-metrics',
      category: 'ops',
      title: tl('notes.auto.n0505'),
      level: 'unknown',
      detail: tl('notes.auto.n1174'),
      fixHref: '/metrics' });
  }

  // Key unit activity (read-only systemctl)
  for (const unit of [
    { id: 'svc-nginx', name: 'nginx', title: tl('notes.auto.n0344'), href: '/nginx', critical: true },
    {
      id: 'svc-fail2ban',
      name: 'fail2ban',
      title: tl('notes.auto.n0283'),
      href: '/protection/fail2ban',
      critical: false },
  ] as const) {
    try {
      const st = await host.serviceStatus(unit.name);
      const active = (st.stdout || '').trim() === 'active';
      const binOk = items.find((i) => i.id === `bin-${unit.name === 'fail2ban' ? 'fail2ban' : unit.name}`);
      // if binary missing, skip service check noise — already reported
      if (binOk && binOk.level !== 'ready' && unit.name === 'nginx') {
        push({
          id: unit.id,
          category: 'ops',
          title: unit.title,
          level: 'missing',
          detail: tl('notes.auto.n0507'),
          fixHref: unit.href,
          severity: unit.critical ? 'critical' : 'optional' });
      } else {
        push({
          id: unit.id,
          category: 'ops',
          title: unit.title,
          level: active ? 'ready' : unit.critical ? 'degraded' : 'degraded',
          detail: active ? 'systemctl is-active: active' : `systemctl is-active: ${(st.stdout || st.stderr || 'inactive').trim()}`,
          fixHint: active ? undefined : tl('notes.auto.t0392', { v0: (unit.name) }),
          fixHref: active ? undefined : '/services',
          severity: unit.critical ? 'critical' : 'optional' });
      }
    } catch {
      push({
        id: unit.id,
        category: 'ops',
        title: unit.title,
        level: 'unknown',
        detail: tl('notes.auto.n1171'),
        fixHref: '/services' });
    }
  }

  // S8: Apache must not steal public :80 when Nginx is the edge
  try {
    const apacheActive = await host.runCommand(['systemctl', 'is-active', 'apache2'], {
      timeoutMs: 5_000,
    });
    const isApacheUp = (apacheActive.stdout || apacheActive.stderr || '').trim() === 'active';
    if (isApacheUp) {
      const ports = await host.runCommand(
        [
          'bash',
          '-c',
          "ss -lntp 2>/dev/null | grep -E ':80\\b' || netstat -lntp 2>/dev/null | grep -E ':80\\b' || true",
        ],
        { timeoutMs: 8_000 },
      );
      const listen = `${ports.stdout || ''}${ports.stderr || ''}`;
      const apacheOn80 =
        /apache2|httpd/i.test(listen) && /:80\b/.test(listen);
      const nginxOn80 = /nginx/i.test(listen) && /:80\b/.test(listen);
      if (apacheOn80 && !nginxOn80) {
        push({
          id: 'ops-apache-port80',
          category: 'ops',
          title: tl('readiness.apachePort80Title'),
          level: 'degraded',
          detail: tl('readiness.apachePort80Detail'),
          fixHint: tl('readiness.apachePort80Fix'),
          fixHref: '/services',
          severity: 'critical',
        });
      } else if (apacheOn80 && nginxOn80) {
        push({
          id: 'ops-apache-port80',
          category: 'ops',
          title: tl('readiness.apachePort80Title'),
          level: 'degraded',
          detail: tl('readiness.apachePort80Both'),
          fixHref: '/services',
          severity: 'critical',
        });
      } else {
        push({
          id: 'ops-apache-port80',
          category: 'ops',
          title: tl('readiness.apachePort80Title'),
          level: 'ready',
          detail: tl('readiness.apachePort80Ok'),
          severity: 'optional',
        });
      }
    }
  } catch {
    /* optional probe */
  }

  // Per-project OS isolation (independent Linux user + /home/ysk-server-{id})
  if (input.projects) {
    for (const item of buildProjectIsolationReadinessItems(input.projects)) {
      if (!item.fixHref && item.level !== 'ready') {
        item.fixHref = '/projects';
      }
      push(item);
    }
  }

  // —— G4 ops: store backend · backup freshness · fleet sessions ——
  if (input.db) {
    const kind = input.storeKind ?? 'json';
    const users = input.db.snapshot.users?.length ?? 0;
    const projects = input.db.snapshot.projects?.length ?? 0;
    push({
      id: 'state-store',
      category: 'ops',
      title: tl('readiness.itemStateStore'),
      level: users > 0 || projects >= 0 ? 'ready' : 'degraded',
      detail: `backend=${kind}; users=${users}; projects=${projects}`,
      fixHint: kind === 'json' ? tl('readiness.itemStateStoreSqliteHint') : undefined,
      fixHref: '/system',
      severity: 'optional',
    });

    // last backup run (settings JSON)
    let lastBackupAt: string | null = null;
    try {
      const raw = input.db.snapshot.settings?.['last_backup_run'];
      if (raw) {
        const parsed = JSON.parse(raw) as { at?: string };
        lastBackupAt = parsed.at ?? null;
      }
    } catch {
      lastBackupAt = null;
    }
    // also try settings repo style key via free form
    if (!lastBackupAt) {
      try {
        const raw = (input.db.snapshot as { settings?: Record<string, unknown> }).settings;
        // some stores keep last_backup_run as nested object via SettingsRepository not settings map
        void raw;
      } catch {
        /* */
      }
    }
    const ageMs = lastBackupAt ? Date.now() - new Date(lastBackupAt).getTime() : null;
    const ageDays = ageMs != null && Number.isFinite(ageMs) ? ageMs / 86_400_000 : null;
    push({
      id: 'backup-freshness',
      category: 'ops',
      title: tl('readiness.itemBackupFreshness'),
      level:
        ageDays == null
          ? 'degraded'
          : ageDays <= 2
            ? 'ready'
            : ageDays <= 7
              ? 'degraded'
              : 'missing',
      detail:
        ageDays == null
          ? tl('readiness.itemBackupNone')
          : `last=${lastBackupAt}; ageDays=${ageDays.toFixed(1)}`,
      fixHint: tl('readiness.itemBackupFix'),
      fixHref: '/backups',
      severity: ageDays != null && ageDays > 7 ? 'critical' : 'optional',
    });

    const sessions = input.db.snapshot.agent_sessions ?? [];
    const connected = sessions.filter((s) => s.status === 'connected').length;
    const registered = sessions.filter((s) => s.status === 'registered').length;
    push({
      id: 'fleet-sessions',
      category: 'ops',
      title: tl('readiness.itemFleetSessions'),
      level: sessions.length === 0 ? 'degraded' : connected > 0 ? 'ready' : 'degraded',
      detail: `total=${sessions.length}; connected=${connected}; registered_only=${registered}`,
      fixHint:
        sessions.length === 0
          ? tl('readiness.itemFleetNone')
          : connected === 0
            ? tl('readiness.itemFleetNoHb')
            : undefined,
      fixHref: '/agents',
      severity: 'optional',
    });
  }

  const ready = items.filter((i) => i.level === 'ready').length;
  const degraded = items.filter((i) => i.level === 'degraded').length;
  const missing = items.filter((i) => i.level === 'missing').length;
  const criticalMissing = items.filter(
    (i) =>
      i.level === 'missing' &&
      (i.id === 'bin-nginx' || i.id === 'bin-node' || i.id === 'control-plane'),
  );

  const productionReady =
    mode === 'production_capable' &&
    criticalMissing.length === 0 &&
    items.find((i) => i.id === 'bin-nginx')?.level === 'ready' &&
    items.find((i) => i.id === 'bin-node')?.level === 'ready';

  const blockers = items.filter((i) => {
    if (i.level === 'missing') return true;
    if (i.severity === 'critical' && i.level !== 'ready') return true;
    if (
      (i.id === 'execute-policy' || i.id === 'root') &&
      i.level !== 'ready'
    ) {
      return true;
    }
    return false;
  });

  const modeLabel =
    mode === 'production_capable'
      ? tl('notes.auto.modeProductionCapable')
      : tl('notes.auto.modeDegraded');
  const summary: string[] = [
    // Full phrase (no raw enum leak like "degraded")
    mode === 'production_capable'
      ? tl('notes.auto.n1013')
      : tl('notes.auto.t0393', { v0: modeLabel }),
    productionReady
      ? tl('notes.auto.n1246')
      : tl('notes.auto.n1245'),
    tl('notes.auto.t0394', { v0: (ready), v1: (degraded), v2: (missing), v3: (items.length) }),
    blockers.length
      ? tl('notes.tpl.priorityBlockers', {
          count: blockers.length,
          list:
            blockers
              .slice(0, 5)
              .map((b) => b.title)
              .join(getLocale() === 'en' ? ', ' : '、') + (blockers.length > 5 ? '…' : ''),
        })
      : tl('notes.auto.n1197'),
  ];
  if (!executeEnabled) {
    summary.push(tl('notes.auto.n0532'));
  }
  if (!isRoot) {
    summary.push(tl('notes.auto.n1271'));
  }

  const catSet = new Set(items.map((i) => i.category));
  const categories = [
    ...READINESS_CATEGORY_ORDER.filter((c) => catSet.has(c)),
    ...[...catSet].filter((c) => !(READINESS_CATEGORY_ORDER as readonly string[]).includes(c)),
  ];

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
    blockers,
    categories };
}
